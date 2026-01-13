import os
import time
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

# 1. Define the tool
def get_weather(city: str) -> str:
    """Get weather for a given city."""
    return f"It's always sunny in {city}!"

# 2. Instantiate the model object (not a string)
# Make sure OPENAI_API_KEY is set in your environment
model = ChatOpenAI(model="gpt-4.1", api_key="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")

# 3. Create the graph (ReAct agent)
# This replaces the non-existent 'create_agent'
graph = create_react_agent(model, tools=[get_weather])

# 4. Stream the execution
# We use the compiled graph to stream
inputs = {"messages": [("user", "What is the weather in SF?")]}
print("--- Starting Stream ---")
start_time = time.perf_counter()
for message, metadata in graph.stream(inputs, stream_mode="messages"):
    # 'event' in LangGraph stream usually contains the node name as the key
    if message.content and metadata["langgraph_node"] == "agent":
        print(message.content, end="", flush=True)

end_time = time.perf_counter()
elapsed_time = end_time - start_time
print(f"\nTotal execution time: {elapsed_time:.4f} seconds")