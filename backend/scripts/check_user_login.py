"""
诊断脚本：检查邮箱登录问题
用法: cd backend && python scripts/check_user_login.py <邮箱或用户名>

会输出：
1. 数据库中该用户的 email、username 实际存储值
2. 按 username 查找结果
3. 按 email 查找结果（精确、正则）
"""
import sys
import os
import re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection


def main():
    if len(sys.argv) < 2:
        print("用法: python scripts/check_user_login.py <邮箱或用户名>")
        print("示例: python scripts/check_user_login.py user@connect.ust.hk")
        sys.exit(1)

    identifier = sys.argv[1].strip()
    secrets = load_secrets()
    _, db, users_collection = get_mongo_db_connection(
        mongo_uri=secrets["MONGO_URI"],
        db_name=secrets["MONGO_DB_NAME"],
        collection_name=secrets["USER"]
    )

    print(f"\n=== 输入: '{identifier}' ===")
    print(f"  repr: {repr(identifier)}")
    print(f"  len: {len(identifier)}, bytes: {identifier.encode('utf-8')}")

    # 1. 按 username 查找
    user_by_username = users_collection.find_one({"username": identifier})
    print(f"\n1. find_one({{'username': '{identifier}'}}):")
    if user_by_username:
        print(f"   找到! email={repr(user_by_username.get('email'))}, is_verified={user_by_username.get('is_verified')}")
    else:
        print("   未找到")

    # 2. 按 email 精确查找 (lower)
    normalized = identifier.lower()
    user_by_email = users_collection.find_one({"email": normalized})
    print(f"\n2. find_one({{'email': '{normalized}'}}):")
    if user_by_email:
        print(f"   找到! username={user_by_email.get('username')}, is_verified={user_by_email.get('is_verified')}")
    else:
        print("   未找到")

    # 3. 正则查找（兼容前后空格）
    if '@' in identifier:
        pattern = r"^\s*" + re.escape(normalized) + r"\s*$"
        user_by_regex = users_collection.find_one({"email": {"$regex": pattern}})
        print(f"\n3. find_one({{'email': {{'$regex': '{pattern}'}}}}):")
        if user_by_regex:
            print(f"   找到! email={repr(user_by_regex.get('email'))}")
        else:
            print("   未找到")

    # 4. 列出所有用户（仅 email 和 username，便于对比）
    print("\n4. 数据库中所有用户的 email 与 username:")
    for u in users_collection.find({}, {"email": 1, "username": 1, "is_verified": 1}):
        e = u.get("email", "")
        print(f"   email={repr(e)} (len={len(e)}) | username={repr(u.get('username'))} | verified={u.get('is_verified')}")


if __name__ == "__main__":
    main()
