"""
Delete all video submissions for sherlinwong (wyswongaa@connect.ust.hk).
Removes documents from: video_submissions, video_scores, video_collected_data,
video_jobs, and video_result_tokens.

Run from the project root:
  python delete_sherlinwong_submissions.py

Pass --confirm to actually delete (dry-run by default).
"""

import sys
import pymongo
from bson import ObjectId

MONGO_URI = "mongodb+srv://hkustmgmt:hkust@cluster0.hjzehx.mongodb.net/?appName=Cluster0"
DB_NAME = "survey"
TARGET_EMAIL = "wyswongaa@connect.ust.hk"

DRY_RUN = "--confirm" not in sys.argv

client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
db = client[DB_NAME]

# Find all matching submissions
submissions = list(db["video_submissions"].find(
    {"submitter_email": TARGET_EMAIL},
    {"_id": 1, "status": 1, "upload_status": 1, "created_at": 1, "filename": 1}
))

if not submissions:
    print(f"No submissions found for {TARGET_EMAIL}")
    sys.exit(0)

print(f"Found {len(submissions)} submission(s) for {TARGET_EMAIL}:")
for s in submissions:
    print(f"  {s['_id']}  status={s.get('status')}  upload={s.get('upload_status')}  file={s.get('filename')}")

if DRY_RUN:
    print("\nDRY RUN — pass --confirm to delete.")
    sys.exit(0)

sub_ids = [str(s["_id"]) for s in submissions]
obj_ids = [s["_id"] for s in submissions]

# Delete related documents first
r_scores   = db["video_scores"].delete_many({"submission_id": {"$in": sub_ids}})
r_data     = db["video_collected_data"].delete_many({"submission_id": {"$in": sub_ids}})
r_jobs     = db["video_jobs"].delete_many({"submission_id": {"$in": sub_ids}})
r_tokens   = db["video_result_tokens"].delete_many({"submission_id": {"$in": sub_ids}})
r_subs     = db["video_submissions"].delete_many({"_id": {"$in": obj_ids}})

print(f"\nDeleted:")
print(f"  video_submissions:    {r_subs.deleted_count}")
print(f"  video_scores:         {r_scores.deleted_count}")
print(f"  video_collected_data: {r_data.deleted_count}")
print(f"  video_jobs:           {r_jobs.deleted_count}")
print(f"  video_result_tokens:  {r_tokens.deleted_count}")
print(f"\nDone. {TARGET_EMAIL} can now resubmit.")
