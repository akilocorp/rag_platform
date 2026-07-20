"""Thin S3 helpers for the user file library.

Credentials are pulled from app.config (loaded by src.utils.config.load_secrets).
"""

import logging

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from flask import current_app

logger = logging.getLogger(__name__)


def get_s3_client():
    return boto3.client(
        's3',
        aws_access_key_id=current_app.config.get('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=current_app.config.get('AWS_SECRET_ACCESS_KEY'),
        region_name=current_app.config.get('AWS_REGION'),
    )


def get_bucket():
    return current_app.config.get('AWS_S3_BUCKET_NAME')


def upload_file(local_path: str, key: str, content_type: str | None = None) -> str:
    extra = {'ContentType': content_type} if content_type else {}
    get_s3_client().upload_file(local_path, get_bucket(), key, ExtraArgs=extra)
    return key


def generate_presigned_put_url(
    key: str,
    content_type: str,
    expires_in: int = 900,
) -> str:
    """Presigned URL for a direct browser PUT upload.

    The browser MUST send the exact same Content-Type when uploading, or S3
    returns 403 (the header is part of the signature).
    """
    return get_s3_client().generate_presigned_url(
        'put_object',
        Params={'Bucket': get_bucket(), 'Key': key, 'ContentType': content_type},
        ExpiresIn=expires_in,
    )


def object_exists(key: str) -> bool:
    """True if the object is present (used to confirm a direct upload landed)."""
    try:
        get_s3_client().head_object(Bucket=get_bucket(), Key=key)
        return True
    except (ClientError, BotoCoreError):
        return False


def delete_object(key: str) -> None:
    try:
        get_s3_client().delete_object(Bucket=get_bucket(), Key=key)
    except (ClientError, BotoCoreError) as e:
        logger.error(f"S3 delete failed for {key}: {e}")


def generate_download_url(
    key: str,
    expires_in: int = 300,
    filename: str | None = None,
    disposition: str = 'attachment',
) -> str:
    # disposition='inline' lets the browser display the file (PDF/text/image)
    # in a tab or iframe instead of forcing a download — used by the chat
    # source chips' open-in-new-tab and hover preview.
    params = {'Bucket': get_bucket(), 'Key': key}
    if filename:
        params['ResponseContentDisposition'] = f'{disposition}; filename="{filename}"'
    elif disposition == 'inline':
        params['ResponseContentDisposition'] = 'inline'
    return get_s3_client().generate_presigned_url(
        'get_object', Params=params, ExpiresIn=expires_in
    )
