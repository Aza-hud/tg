from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import hashlib
import hmac
import json
import random
import aiosqlite
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Set
from datetime import datetime, timezone
import httpx
from urllib.parse import parse_qsl

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
DB_PATH = ROOT_DIR / 'ghostchat.db'

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.typing_users: Dict[str, Set[str]] = {}
    
    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"User {user_id} connected. Total: {len(self.active_connections)}")
        await self.broadcast_status(user_id, "online")
    
    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            for recipients in self.typing_users.values():
                recipients.discard(user_id)
            logger.info(f"User {user_id} disconnected. Total: {len(self.active_connections)}")
    
    async def broadcast_status(self, user_id: str, status: str):
        message = {"type": "status", "user_id": user_id, "status": status}
        for uid, ws in self.active_connections.items():
            if uid != user_id:
                try:
                    await ws.send_json(message)
                except:
                    pass
    
    def is_online(self, user_id: str) -> bool:
        return user_id in self.active_connections
    
    def get_online_users(self) -> List[str]:
        return list(self.active_connections.keys())
    
    async def send_to_user(self, user_id: str, message: dict):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
                return True
            except Exception as e:
                logger.error(f"Failed to send to {user_id}: {e}")
                return False
        return False
    
    def set_typing(self, sender_id: str, recipient_id: str, is_typing: bool):
        if recipient_id not in self.typing_users:
            self.typing_users[recipient_id] = set()
        if is_typing:
            self.typing_users[recipient_id].add(sender_id)
        else:
            self.typing_users[recipient_id].discard(sender_id)

manager = ConnectionManager()

class UserUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    gender: Optional[str] = None
    avatar_url: Optional[str] = None
    notifications_enabled: Optional[bool] = None

class UserResponse(BaseModel):
    id: str
    telegram_id: str
    anonymous_id: str
    name: Optional[str] = None
    status: Optional[str] = None
    gender: Optional[str] = None
    avatar_url: Optional[str] = None
    notifications_enabled: bool = True
    created_at: str

class ContactAdd(BaseModel):
    target_anonymous_id: str

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                telegram_id TEXT UNIQUE NOT NULL,
                anonymous_id TEXT UNIQUE NOT NULL,
                name TEXT,
                status TEXT,
                gender TEXT,
                avatar_url TEXT,
                notifications_enabled INTEGER DEFAULT 1,
                created_at TEXT NOT NULL
            )
        ''')
        await db.execute('''
            CREATE TABLE IF NOT EXISTS contacts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                contact_anonymous_id TEXT NOT NULL,
                added_at TEXT NOT NULL,
                UNIQUE(user_id, contact_anonymous_id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        ''')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id)')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_users_anonymous ON users(anonymous_id)')
        await db.execute('CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id)')
        await db.commit()
    logger.info("Database initialized")

@app.on_event("startup")
async def startup():
    await init_db()

async def generate_anonymous_id() -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        while True:
            anonymous_id = str(random.randint(1000000, 9999999))
            cursor = await db.execute('SELECT id FROM users WHERE anonymous_id = ?', (anonymous_id,))
            if not await cursor.fetchone():
                return anonymous_id

def validate_telegram_data(init_data: str) -> Optional[dict]:
    if not TELEGRAM_BOT_TOKEN:
        return {"user": {"id": "test_user"}}
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        hash_value = parsed.pop('hash', None)
        if not hash_value:
            return None
        data_check_string = '\n'.join(f'{k}={v}' for k, v in sorted(parsed.items()))
        secret_key = hmac.new(b'WebAppData', TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if calculated_hash == hash_value:
            user_data = json.loads(parsed.get('user', '{}'))
            return {"user": user_data}
        return None
    except Exception as e:
        logger.error(f"Validation error: {e}")
        return None

@api_router.get("/")
async def root():
    return {"message": "GhostChat API", "version": "1.0.0"}

@api_router.get("/online")
async def get_online_users():
    return {"online": manager.get_online_users()}

@api_router.post("/auth/telegram", response_model=UserResponse)
async def auth_telegram(request: Request):
    body = await request.json()
    init_data = body.get('init_data', '')
    telegram_id = body.get('telegram_id')
    
    if not telegram_id:
        validated = validate_telegram_data(init_data)
        if not validated:
            raise HTTPException(status_code=401, detail="Invalid Telegram data")
        telegram_id = str(validated['user'].get('id'))
    
    if not telegram_id:
        raise HTTPException(status_code=400, detail="Missing telegram_id")
    
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute('SELECT * FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        
        if user:
            return UserResponse(
                id=user['id'], telegram_id=user['telegram_id'], anonymous_id=user['anonymous_id'],
                name=user['name'], status=user['status'], gender=user['gender'],
                avatar_url=user['avatar_url'], notifications_enabled=bool(user['notifications_enabled']),
                created_at=user['created_at']
            )
        
        user_id = hashlib.sha256(f"{telegram_id}{datetime.now().isoformat()}".encode()).hexdigest()[:16]
        anonymous_id = await generate_anonymous_id()
        created_at = datetime.now(timezone.utc).isoformat()
        
        await db.execute('INSERT INTO users (id, telegram_id, anonymous_id, created_at) VALUES (?, ?, ?, ?)',
                        (user_id, telegram_id, anonymous_id, created_at))
        await db.commit()
        
        return UserResponse(id=user_id, telegram_id=telegram_id, anonymous_id=anonymous_id,
                           notifications_enabled=True, created_at=created_at)

@api_router.get("/user/me", response_model=UserResponse)
async def get_current_user(telegram_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute('SELECT * FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return UserResponse(
            id=user['id'], telegram_id=user['telegram_id'], anonymous_id=user['anonymous_id'],
            name=user['name'], status=user['status'], gender=user['gender'],
            avatar_url=user['avatar_url'], notifications_enabled=bool(user['notifications_enabled']),
            created_at=user['created_at']
        )

@api_router.put("/user/me", response_model=UserResponse)
async def update_user(telegram_id: str, update: UserUpdate):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute('SELECT * FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        updates, values = [], []
        if update.name is not None: updates.append("name = ?"); values.append(update.name)
        if update.status is not None: updates.append("status = ?"); values.append(update.status)
        if update.gender is not None: updates.append("gender = ?"); values.append(update.gender)
        if update.avatar_url is not None: updates.append("avatar_url = ?"); values.append(update.avatar_url)
        if update.notifications_enabled is not None: updates.append("notifications_enabled = ?"); values.append(1 if update.notifications_enabled else 0)
        
        if updates:
            values.append(telegram_id)
            await db.execute(f'UPDATE users SET {", ".join(updates)} WHERE telegram_id = ?', values)
            await db.commit()
        
        cursor = await db.execute('SELECT * FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        return UserResponse(
            id=user['id'], telegram_id=user['telegram_id'], anonymous_id=user['anonymous_id'],
            name=user['name'], status=user['status'], gender=user['gender'],
            avatar_url=user['avatar_url'], notifications_enabled=bool(user['notifications_enabled']),
            created_at=user['created_at']
        )

@api_router.get("/user/search")
async def search_user(anonymous_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute('SELECT anonymous_id, name, status, gender, avatar_url FROM users WHERE anonymous_id = ?', (anonymous_id,))
        user = await cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {"anonymous_id": user['anonymous_id'], "name": user['name'], "status": user['status'],
                "gender": user['gender'], "avatar_url": user['avatar_url'], "is_online": manager.is_online(user['anonymous_id'])}

@api_router.post("/contacts/add")
async def add_contact(telegram_id: str, contact: ContactAdd):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute('SELECT id, anonymous_id FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        if not user: raise HTTPException(status_code=404, detail="User not found")
        
        cursor = await db.execute('SELECT id FROM users WHERE anonymous_id = ?', (contact.target_anonymous_id,))
        if not await cursor.fetchone(): raise HTTPException(status_code=404, detail="Target user not found")
        if user['anonymous_id'] == contact.target_anonymous_id: raise HTTPException(status_code=400, detail="Cannot add yourself")
        
        cursor = await db.execute('SELECT id FROM contacts WHERE user_id = ? AND contact_anonymous_id = ?', (user['id'], contact.target_anonymous_id))
        if await cursor.fetchone(): raise HTTPException(status_code=400, detail="Contact already added")
        
        contact_id = hashlib.sha256(f"{user['id']}{contact.target_anonymous_id}{datetime.now().isoformat()}".encode()).hexdigest()[:16]
        await db.execute('INSERT INTO contacts (id, user_id, contact_anonymous_id, added_at) VALUES (?, ?, ?, ?)',
                        (contact_id, user['id'], contact.target_anonymous_id, datetime.now(timezone.utc).isoformat()))
        await db.commit()
        return {"message": "Contact added", "contact_id": contact_id}

@api_router.delete("/contacts/{contact_anonymous_id}")
async def remove_contact(telegram_id: str, contact_anonymous_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute('SELECT id FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        if not user: raise HTTPException(status_code=404, detail="User not found")
        await db.execute('DELETE FROM contacts WHERE user_id = ? AND contact_anonymous_id = ?', (user[0], contact_anonymous_id))
        await db.commit()
        return {"message": "Contact removed"}

@api_router.get("/contacts")
async def get_contacts(telegram_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute('SELECT id FROM users WHERE telegram_id = ?', (telegram_id,))
        user = await cursor.fetchone()
        if not user: raise HTTPException(status_code=404, detail="User not found")
        
        cursor = await db.execute('''
            SELECT c.contact_anonymous_id, u.name, u.status, u.gender, u.avatar_url, c.added_at
            FROM contacts c LEFT JOIN users u ON c.contact_anonymous_id = u.anonymous_id
            WHERE c.user_id = ? ORDER BY c.added_at DESC
        ''', (user['id'],))
        contacts = await cursor.fetchall()
        return [{"anonymous_id": c['contact_anonymous_id'], "name": c['name'], "status": c['status'],
                 "gender": c['gender'], "avatar_url": c['avatar_url'], "added_at": c['added_at'],
                 "is_online": manager.is_online(c['contact_anonymous_id'])} for c in contacts]

@app.websocket("/ws/{anonymous_id}")
async def websocket_endpoint(websocket: WebSocket, anonymous_id: str):
    await manager.connect(anonymous_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get('type') == 'message':
                recipient_id, text = data.get('recipient_id'), data.get('text', '').strip()
                if recipient_id and text:
                    manager.set_typing(anonymous_id, recipient_id, False)
                    message = {"type": "message", "sender_id": anonymous_id, "text": text, "timestamp": datetime.now(timezone.utc).isoformat()}
                    sent = await manager.send_to_user(recipient_id, message)
                    await websocket.send_json({"type": "message_sent", "recipient_id": recipient_id, "delivered": sent, "timestamp": message['timestamp']})
            elif data.get('type') == 'typing':
                recipient_id, is_typing = data.get('recipient_id'), data.get('is_typing', True)
                if recipient_id:
                    manager.set_typing(anonymous_id, recipient_id, is_typing)
                    await manager.send_to_user(recipient_id, {"type": "typing", "sender_id": anonymous_id, "is_typing": is_typing})
            elif data.get('type') == 'ping':
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(anonymous_id)
        await manager.broadcast_status(anonymous_id, "offline")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(anonymous_id)

@api_router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    if not TELEGRAM_BOT_TOKEN: return {"ok": True}
    try:
        update = await request.json()
        message = update.get('message', {})
        chat_id = message.get('chat', {}).get('id')
        text = message.get('text', '')
        if text == '/start':
            webapp_url = os.environ.get('WEBAPP_URL', 'https://massagertg.tw1.su')
            async with httpx.AsyncClient() as client:
                await client.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                    json={"chat_id": chat_id, "text": "👻 GhostChat - Анонимный Мессенджер\n\nНажмите кнопку ниже:",
                          "reply_markup": {"inline_keyboard": [[{"text": "🚀 Открыть GhostChat", "web_app": {"url": webapp_url}}]]}})
        return {"ok": True}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"ok": False}

app.include_router(api_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])