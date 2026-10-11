import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()
client = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=10000)
client.admin.command("ping")
print("Connected. Server version:", client.server_info()["version"])
print("Databases:", client.list_database_names())
