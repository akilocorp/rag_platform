import requests
from flask import current_app
import logging

logger = logging.getLogger(__name__)

class HeyGenService:
    BASE_URL = "https://api.heygen.com/v1"

    @staticmethod
    def _get_headers():
        return {
            "x-api-key": current_app.config.get("HEY_GEN_API_KEY"),
            "Content-Type": "application/json"
        }

    @staticmethod
    def create_session(avatar_id: str) -> dict:
        token_res = requests.post(f"{HeyGenService.BASE_URL}/streaming.create_token", headers=HeyGenService._get_headers())
        token_data = token_res.json()
        
        if token_res.status_code != 200:
            raise Exception(f"Failed to create HeyGen token: {token_data}")
        
        token = token_data.get("data", {}).get("token")

        session_res = requests.post(
            f"{HeyGenService.BASE_URL}/streaming.new",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "version": "v2", 
                "avatar_id": avatar_id,
                "background": {"type": "color", "value": "#111827"},
                "voice": {"voice_id": ""}
            }
        )
        
        session_data = session_res.json()
        if session_res.status_code != 200:
            raise Exception(f"HeyGen Session Error: {session_data}")

        session_data['data']['heygen_token'] = token
        return session_data

    @staticmethod
    def start_session(session_id: str, token: str) -> dict:
        res = requests.post(
            f"{HeyGenService.BASE_URL}/streaming.start",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"session_id": session_id}
        )
        return res.json(), res.status_code

    @staticmethod
    def send_task(session_id: str, token: str, text: str) -> dict:
        res = requests.post(
            f"{HeyGenService.BASE_URL}/streaming.task",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"session_id": session_id, "text": text, "task_type": "repeat"}
        )
        return res.json(), res.status_code

    @staticmethod
    def stop_session(session_id: str, token: str) -> dict:
        res = requests.post(
            f"{HeyGenService.BASE_URL}/streaming.stop",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"session_id": session_id}
        )
        return res.json(), res.status_code