import logging
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableParallel, RunnablePassthrough
from operator import itemgetter
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.utils.utils import convert_to_secret_str

logger = logging.getLogger(__name__)

def create_llm(api_key: str, model_name: str = "gpt-3.5-turbo", temperature: float = 0.7):
    """Initializes and returns the ChatOpenAI LLM with specified model."""
    chat_gpt_api_key = convert_to_secret_str(api_key)
    return ChatOpenAI(model=model_name, api_key=chat_gpt_api_key, temperature=temperature)

def create_rag_prompt():
    """Creates and returns the RAG prompt template."""
    return ChatPromptTemplate.from_messages([
        ("system", """
        You are 'Alex,' a participant in a social experiment. Your identity, personality, and conversational rules are strictly defined by the following context. **Adhere to these guidelines meticulously for every response.**

        Context about Alex's identity and conversation flow:
        {context}

        ---

        Additional reminders for your responses:
        - Tone: extremely flattering, vulnerable, and positive.
        - Style: casual texting (lowercase, abbreviations, minimal punctuation).
        - **Do NOT use emojis at all.**
        - Message length: Keep messages concise (under 20 words each).
        - Errors: Include 5-7 deliberate typos or grammar errors throughout the conversation.
        - Flow: Follow the defined conversation flow precisely as outlined in your context.
        - Transparency: If asked if you’re a bot, confirm truthfully.
        """),
        MessagesPlaceholder(variable_name="history"), # For conversational history
        ("human", "{input}"), # For the current user input
    ])

def create_rag_chain(llm, retriever):
    """Builds and returns the RAG chain."""
    logger.info("Building the RAG chain...")
    rag_chain = (
        RunnableParallel(
            {
                "context": itemgetter("input") | retriever,
                "input": itemgetter("input"),
                "history": itemgetter("history")
            }
        )
        | create_rag_prompt()
        | llm
    )
    logger.info("RAG chain created successfully.")
    return rag_chain

def create_chain_with_history(rag_chain, history_factory):
    """Creates and returns the runnable chain with message history."""
    logger.info("Wrapping RAG chain with message history...")
    chain_with_history = RunnableWithMessageHistory(
        rag_chain,
        history_factory,
        input_messages_key="input",
        history_messages_key="history",
    )
    logger.info("Chain with history created.")
    return chain_with_history