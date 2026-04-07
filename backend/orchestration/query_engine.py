import json
import logging
from typing import List, Dict, Any, Generator
import openai
from flask import current_app
# Import our custom tool registry from Step 1
from tools import get_tool_schemas, execute_tool
from orchestration.model_registry import get_provider_config

logger = logging.getLogger(__name__)

class QueryEngine:
    def __init__(self, config_id: str, chat_id: str, user_id: str, db, config_doc: dict):
        self.config_id = config_id
        self.chat_id = chat_id
        self.user_id = user_id
        self.db = db
        self.config_doc = config_doc
        
        self.model = config_doc.get("model_name", "gpt-4o")
        self.max_turns = 8 
        
        # --- DYNAMIC MODEL ROUTING ---
        # 1. Ask the registry how to connect to this model
        provider = get_provider_config(self.model)
        
        # 2. Fetch the specific API key from Flask's config
        api_key = current_app.config.get(provider.api_key_config_name)
        
        if not api_key:
            raise ValueError(f"Missing API Key: {provider.api_key_config_name} is required for {self.model}")

        # 3. Initialize the client
        self.client = openai.OpenAI(
            api_key=api_key, 
            base_url=provider.base_url
        )

        # Context for our tools
        self.tool_context = {
            "config_id": self.config_id,
            "user_id": self.user_id,
            "db": self.db,
            # Tools like Vector Search STILL need the OpenAI key for embeddings
            "openai_api_key": current_app.config.get("OPENAI_API_KEY"), 
            "sql_uri": current_app.config.get("SQL_DB_URI", "sqlite:///rag_structured_data.db")
        }
    def _get_system_prompt(self) -> str:
        base = self.config_doc.get("prompt_template", "You are a helpful assistant.")
        return f"""{base}

You are an advanced Hybrid AI Data Analyst. You have access to two distinct tools:
1. 'search_unstructured_docs': For text, concepts, summaries, and reading PDFs/Word docs.
2. 'analytical_sql_agent': For math, exact numbers, aggregations, and tabular Excel data (e.g., "top 5 stocks", "total revenue", "NPV").

STANDARD OPERATING PROCEDURE (SOP) - YOU MUST FOLLOW THIS EXACT WORKFLOW:
Step 1. PLAN: Briefly state your thought process and select the most logical tool to start with.
Step 2. EVALUATE: After a tool returns a result, evaluate it. Did it contain the answer? 
Step 3. PIVOT (CRITICAL): If the first tool returns an error, "no results found", or insufficient data, YOU ARE NOT FINISHED. You must immediately state your pivot thought and call the OTHER tool.
Step 4. SYNTHESIZE: Only provide a final answer to the user after you have successfully found the data, OR after you have exhausted both tools.

UNIVERSAL RULES:
- Never tell the user "I cannot find the answer" if you have only used one tool. You must check both the unstructured text and the structured SQL database before giving up.
- For hybrid questions, use both tools sequentially to build a complete answer.

EXAMPLE WORKFLOW:
Thought: The user wants the NPV. I'll check the text documents first.
[Calls search_unstructured_docs]
Result: "No relevant text documents found."
Thought: It wasn't in the unstructured text. Following my SOP, I must pivot and check the structured database for this metric.
[Calls analytical_sql_agent]
Result: "The NPV is $45,000"
Final Answer: "Based on the financial model, the NPV is $45,000."
"""

    def stream_response(self, user_input: str, history: List[Dict[str, Any]]) -> Generator[str, None, None]:
        messages = [{"role": "system", "content": self._get_system_prompt()}]
        messages.extend(history)
        
        new_messages = [{"role": "user", "content": user_input}]
        messages.append(new_messages[0])

        turn_count = 0
        
        print("\n" + "="*50)
        print(f"🚀 NEW AGENT RUN STARTED")
        print("="*50)

        while turn_count < self.max_turns:
            turn_count += 1
            print(f"\n🔄 [TURN {turn_count}] AGENT IS THINKING...")
            
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=get_tool_schemas(),
                    stream=True
                )
                
                accumulated_tool_calls = {}
                assistant_text = ""

                for chunk in response:
                    delta = chunk.choices[0].delta
                    
                    # --- THE MODEL IS THINKING OR SPEAKING ---
                    if delta.content:
                        assistant_text += delta.content
                        # Print the model's thought process to your backend console in real-time!
                        print(delta.content, end="", flush=True)
                        
                        # Stream the thought to the frontend so the user can read it too
                        yield json.dumps({"type": "token", "data": delta.content}) + "\n"

                    # --- THE MODEL IS PREPARING A TOOL ---
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in accumulated_tool_calls:
                                accumulated_tool_calls[idx] = {
                                    "id": tc.id, "type": "function",
                                    "function": {"name": tc.function.name, "arguments": ""}
                                }
                            if tc.function.arguments:
                                accumulated_tool_calls[idx]["function"]["arguments"] += tc.function.arguments

                print("\n") # Newline after the stream finishes

                # --- NO TOOLS CALLED: THE TASK IS DONE ---
                if not accumulated_tool_calls:
                    print(f"✅ [TURN {turn_count}] Task complete. Agent provided final answer.")
                    final_msg = {"role": "assistant", "content": assistant_text}
                    messages.append(final_msg)
                    new_messages.append(final_msg)
                    break

                # --- TOOLS CALLED: EXECUTE AND LOOP BACK ---
                tool_calls_list = list(accumulated_tool_calls.values())
                
                print(f"🛠️ [TURN {turn_count}] AGENT DECIDED TO USE {len(tool_calls_list)} TOOL(S):")
                
                assistant_tool_msg = {
                    "role": "assistant", "content": assistant_text or None, "tool_calls": tool_calls_list
                }
                messages.append(assistant_tool_msg)
                new_messages.append(assistant_tool_msg)

                for tc in tool_calls_list:
                    t_name = tc["function"]["name"]
                    r_args = tc["function"]["arguments"]
                    t_id = tc["id"]
                    
                    print(f"   -> Triggering: {t_name}")
                    print(f"   -> Arguments: {r_args}")
                    
                    yield json.dumps({"type": "tool_start", "data": f"\n\n*Running {t_name}...*\n\n"}) + "\n"

                    try:
                        arguments = json.loads(r_args)
                        t_result = execute_tool(t_name, arguments, self.tool_context)
                    except Exception as e:
                        t_result = f"Error executing tool: {str(e)}"

                    # Print a snippet of the result to the backend console
                    preview = str(t_result).replace("\n", " ")[:150]
                    print(f"   <- Result: {preview}...\n")

                    tool_result_msg = {"role": "tool", "tool_call_id": t_id, "name": t_name, "content": str(t_result)}
                    messages.append(tool_result_msg)
                    new_messages.append(tool_result_msg)
                
            except Exception as e:
                logger.error(f"Error in LLM loop: {e}")
                print(f"❌ ERROR: {e}")
                yield json.dumps({"type": "error", "data": str(e)}) + "\n"
                break

        if turn_count >= self.max_turns:
            print(f"🛑 KILLED: Max turns ({self.max_turns}) reached. Infinite loop prevented.")
            yield json.dumps({"type": "error", "data": "Max turns reached."}) + "\n"
        
        print("="*50)
        print(f"🏁 AGENT RUN FINISHED")
        print("="*50 + "\n")
        
        yield json.dumps({"type": "final_state", "data": new_messages}) + "\n"