import logging
import os
from typing import Optional, Dict, List
from flask import current_app

logger = logging.getLogger(__name__)

# --- LangChain Imports ---
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_community.chat_models import ChatTongyi
from langchain_deepseek import ChatDeepSeek
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful, neutral conversational partner. "
    "Keep the conversation natural and balanced."
)

class ChatBot:
    """
    Chat Bot Class representing a unique persona.
    Dynamically loads LLMs based on the per-bot config selection.
    """

    def __init__(self, room_id: str, bot_config: Dict):
        self.room_id = room_id
        self.name = bot_config.get("name", "Assistant")
        self.model_name = bot_config.get("model_name", "gpt-4o")
        self.temperature = float(bot_config.get("temperature", 0.7))
        
        system_prompt = bot_config.get("prompt", "")
        identity_instr = f"Your name is {self.name}. Always stay in character as {self.name}. "
        self.system_prompt = identity_instr + (system_prompt if system_prompt else DEFAULT_SYSTEM_PROMPT)

        # Initialize the LangChain LLM dynamically based on the bot's specific model
        self.llm = self._initialize_llm()
        self.output_parser = StrOutputParser()

        print(f"✅ Bot '{self.name}' initialized for room {room_id} using {self.model_name}")

    def _initialize_llm(self):
        """Matches the dynamic model selection, enforcing temperature constraints."""
        primary_openai_key = current_app.config.get("OPENAI_API_KEY")
        fallback_openai_key = current_app.config.get("OPENAI_API_KEY_2")

        model_lower = self.model_name.lower()
        
        # STRICT CONSTRAINT: No temperature for GPT-5 or Gemini
        supports_temp = not ("gpt-5" in model_lower or "gemini" in model_lower)
        temp_kwargs = {"temperature": self.temperature} if supports_temp else {}

        if "gpt-5-nano" in model_lower:
            primary_llm = ChatOpenAI(model="gpt-5-nano", api_key=primary_openai_key, max_tokens=500, **temp_kwargs)
            if fallback_openai_key:
                fallback_llm = ChatOpenAI(model="gpt-5-nano", api_key=fallback_openai_key, max_tokens=500, **temp_kwargs)
                return primary_llm.with_fallbacks([fallback_llm])
            return primary_llm

        elif "gemini" in model_lower:
            return ChatGoogleGenerativeAI(
                model=self.model_name,
                google_api_key=current_app.config.get("GEMINI_API_KEY"),
                **temp_kwargs
            )
            
        elif "qwen" in model_lower:
            return ChatTongyi(
                model=self.model_name,
                api_key=current_app.config.get("DASHSCOPE_API_KEY"),
                **temp_kwargs
            )

        elif "deepseek" in model_lower:
            return ChatDeepSeek(
                model=self.model_name,
                api_key=current_app.config.get("DEEPSEEK_API_KEY"),
                **temp_kwargs
            )

        else:
            # Standard OpenAI Fallback (GPT-4o, GPT-3.5, etc.)
            primary_llm = ChatOpenAI(model=self.model_name, api_key=primary_openai_key, max_tokens=500, **temp_kwargs)
            if fallback_openai_key:
                fallback_llm = ChatOpenAI(model=self.model_name, api_key=fallback_openai_key, max_tokens=500, **temp_kwargs)
                return primary_llm.with_fallbacks([fallback_llm])
            return primary_llm

    def generate_response(self, user_id: str, user_message: str, full_context_summary: str, rag_context: str) -> Optional[str]:
        """Generates a response synchronously using LangChain chains with RAG context."""
        try:
            prompt = ChatPromptTemplate.from_messages([
                ("system", "{system_prompt}\n\nUse the following retrieved documents to inform your answer:\n<documents>\n{rag_context}\n</documents>"),
                ("system", "Here is the current chat context (who said what):\n{context_summary}"),
                ("user", "{user_id}: {user_message}")
            ])

            chain = prompt | self.llm | self.output_parser

            response = chain.invoke({
                "system_prompt": self.system_prompt,
                "rag_context": rag_context,
                "context_summary": full_context_summary,
                "user_id": user_id,
                "user_message": user_message
            })

            return response.strip()
        except Exception as e:
            print(f"❌ Generation Error for {self.name}: {e}")
            return None

    def update_persona(self, new_config: Dict):
        """Updates persona if config changes."""
        self.model_name = new_config.get("model_name", self.model_name)
        self.temperature = float(new_config.get("temperature", self.temperature))
        system_prompt = new_config.get("prompt", "")
        
        identity_instr = f"Your name is {self.name}. Always stay in character as {self.name}. "
        self.system_prompt = identity_instr + (system_prompt if system_prompt else DEFAULT_SYSTEM_PROMPT)
        self.llm = self._initialize_llm()

# ==========================================
# GLOBAL REGISTRY & ORCHESTRATOR
# ==========================================

room_bot_registry: Dict[str, Dict[str, ChatBot]] = {}

def analyze_intent(user_text: str, bots_config: list, history_text: str) -> Optional[str]:
    """Decides which bot should speak using a fast routing model."""
    if not bots_config:
        return None

    # No OpenAI call needed — avoids extra failures when the router model is unavailable (e.g. region block).
    if len(bots_config) == 1:
        return bots_config[0].get("name")

    text_lower = (user_text or "").strip().lower()
    # @Name or explicit mention of a persona name
    for bot in bots_config:
        name = (bot.get("name") or "").strip()
        if not name:
            continue
        nlow = name.lower()
        if text_lower.startswith("@" + nlow) or text_lower.startswith("@" + nlow.replace(" ", "_")):
            return name

    persona_list = "\n".join([f"- {b['name']}: {b['prompt']}" for b in bots_config])

    orchestrator_prompt = """
    You are a strict Chat Orchestrator for a group chat with AI personas.
    Your job is to decide whether any persona should respond to the latest message.
    A persona should ONLY respond if the message is clearly within their area of expertise.

    RECENT HISTORY:
    {history_text}

    AVAILABLE PERSONAS:
    {persona_list}

    RULES (apply in order):
    1. If the user explicitly @mentions a persona by name, pick that persona.
    2. If the message is a direct follow-up question to a persona's previous answer, pick that persona.
    3. If the message topic directly and clearly falls within a persona's stated domain, pick that persona.
    4. Small talk, greetings, off-topic messages, or messages not covered by any persona's domain → return "NONE".
    5. When in doubt, return "NONE". It is better to stay silent than to reply off-topic.

    ONLY return the EXACT NAME of one persona or "NONE". No explanation.
    """

    try:
        router_llm = ChatOpenAI(
            model="gpt-4o-mini", 
            temperature=0, 
            max_tokens=10,
            api_key=current_app.config.get("OPENAI_API_KEY")
        )
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", orchestrator_prompt),
            ("user", 'NEW MESSAGE: "{user_text}"')
        ])

        decision = (prompt | router_llm | StrOutputParser()).invoke({
            "history_text": history_text,
            "persona_list": persona_list,
            "user_text": user_text
        }).strip().replace("@", "")

        for bot in bots_config:
            if bot['name'].lower() in decision.lower():
                return bot['name']
        return None
    except Exception as e:
        logger.warning("Intent router LLM failed: %s", e)
        return None

def get_or_create_bot(room_id: str, bot_config: Dict) -> ChatBot:
    """Retrieves or creates a specific bot persona within a room."""
    if room_id not in room_bot_registry:
        room_bot_registry[room_id] = {}

    room_bots = room_bot_registry[room_id]
    bot_name = bot_config.get("name")

    if bot_name not in room_bots:
        room_bots[bot_name] = ChatBot(room_id, bot_config)
    else:
        room_bots[bot_name].update_persona(bot_config)

    return room_bots[bot_name]

def remove_room_bots(room_id: str):
    if room_id in room_bot_registry:
        del room_bot_registry[room_id]