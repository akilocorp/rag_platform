from dataclasses import dataclass
from typing import Optional

@dataclass
class ModelProvider:
    prefix: str                 # How we identify the model (e.g., 'deepseek', 'gpt')
    api_key_config_name: str    # The key to look for in current_app.config
    base_url: Optional[str]     # The provider's OpenAI-compatible endpoint URL

# --- THE PROVIDER REGISTRY ---
# To add a new provider, just add one line to this list!
SUPPORTED_PROVIDERS = [
    ModelProvider(
        prefix="deepseek", 
        api_key_config_name="DEEPSEEK_API_KEY", 
        base_url="https://api.deepseek.com"
    ),
    ModelProvider(
        prefix="qwen", 
        api_key_config_name="DASHSCOPE_API_KEY", 
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    ),
    ModelProvider(
        prefix="gemini", 
        api_key_config_name="GEMINI_API_KEY", 
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
    ),
    ModelProvider(
        prefix="gpt", 
        api_key_config_name="OPENAI_API_KEY", 
        base_url=None  # None defaults to the standard OpenAI URL
    ),
    # Want to add Claude in the future? Just add:
    # ModelProvider(prefix="claude", api_key_config_name="ANTHROPIC_API_KEY", base_url="...")
]

def get_provider_config(model_name: str) -> ModelProvider:
    """
    Loops through the registry and finds the correct provider for the requested model.
    """
    model_lower = model_name.lower()
    
    for provider in SUPPORTED_PROVIDERS:
        if model_lower.startswith(provider.prefix):
            return provider
            
    # Fallback to OpenAI if the model prefix is completely unknown
    return ModelProvider(
        prefix="unknown", 
        api_key_config_name="OPENAI_API_KEY", 
        base_url=None
    )