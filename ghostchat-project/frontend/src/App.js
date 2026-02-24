import { useEffect, useState, createContext, useContext, useRef, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Search, User, ArrowLeft, SendHorizontal, Bell, Edit2, Check, X, UserPlus, Trash2 } from "lucide-react";
import axios from "axios";
import { Toaster, toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Context for user data
const UserContext = createContext(null);

export const useUser = () => useContext(UserContext);

// Telegram WebApp integration
const getTelegram = () => {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    return window.Telegram.WebApp;
  }
  return null;
};

// WebSocket connection
let ws = null;
let wsReconnectTimeout = null;
let pingInterval = null;

const connectWebSocket = (anonymousId, onMessage) => {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  
  const wsUrl = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
  ws = new WebSocket(`${wsUrl}/ws/${anonymousId}`);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    // Keep alive ping
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  };
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type !== 'pong') {
      onMessage(data);
    }
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    if (pingInterval) clearInterval(pingInterval);
    wsReconnectTimeout = setTimeout(() => connectWebSocket(anonymousId, onMessage), 3000);
  };
  
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
};

const sendWsMessage = (type, data) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
};

// Components
const BottomNav = ({ active }) => {
  const navigate = useNavigate();
  
  const items = [
    { id: 'chats', icon: MessageSquare, label: 'Чаты', path: '/' },
    { id: 'search', icon: Search, label: 'Поиск', path: '/search' },
    { id: 'profile', icon: User, label: 'Профиль', path: '/profile' },
  ];
  
  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-background/95 backdrop-blur border-t border-border z-50 safe-area-bottom" data-testid="bottom-nav">
      <div className="max-w-md mx-auto h-full grid grid-cols-3">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            className={`flex flex-col items-center justify-center gap-1 transition-colors ${
              active === item.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            data-testid={`nav-${item.id}`}
          >
            <item.icon size={22} strokeWidth={active === item.id ? 2.5 : 1.5} />
            <span className="text-xs">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

const Header = ({ title, showBack, onBack, rightAction }) => (
  <header className="fixed top-0 left-0 right-0 h-14 bg-background/95 backdrop-blur border-b border-border z-50 safe-area-top" data-testid="header">
    <div className="max-w-md mx-auto h-full flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {showBack && (
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="back-button">
            <ArrowLeft size={24} />
          </button>
        )}
        <h1 className="font-heading font-semibold text-lg">{title}</h1>
      </div>
      {rightAction}
    </div>
  </header>
);

const Avatar = ({ name, avatarUrl, size = 'md', gender, isOnline }) => {
  const sizes = { sm: 'w-10 h-10 text-sm', md: 'w-12 h-12 text-base', lg: 'w-20 h-20 text-2xl' };
  
  const getInitials = () => {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  };
  
  const getGenderColor = () => {
    if (gender === 'male') return 'from-blue-600 to-blue-800';
    if (gender === 'female') return 'from-pink-500 to-pink-700';
    return 'from-primary to-red-800';
  };
  
  return (
    <div className="relative">
      {avatarUrl ? (
        <div className={`${sizes[size]} rounded-full overflow-hidden border-2 border-border`}>
          <img src={avatarUrl} alt={name || 'Avatar'} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className={`${sizes[size]} rounded-full bg-gradient-to-br ${getGenderColor()} flex items-center justify-center font-heading font-bold`}>
          {getInitials()}
        </div>
      )}
      {isOnline && (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
      )}
    </div>
  );
};

const TypingIndicator = () => (
  <div className="flex items-center gap-1 text-muted-foreground text-xs">
    <span>печатает</span>
    <span className="flex gap-0.5">
      <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  </div>
);

const ContactItem = ({ contact, onClick, onDelete, typingUsers }) => {
  const [showDelete, setShowDelete] = useState(false);
  const isTyping = typingUsers?.includes(contact.anonymous_id);
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative"
    >
      <button
        onClick={onClick}
        onContextMenu={(e) => { e.preventDefault(); setShowDelete(!showDelete); }}
        className="w-full flex items-center gap-3 p-3 hover:bg-card rounded-lg transition-colors text-left"
        data-testid={`contact-${contact.anonymous_id}`}
      >
        <Avatar 
          name={contact.name} 
          avatarUrl={contact.avatar_url} 
          gender={contact.gender}
          isOnline={contact.is_online}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{contact.name || 'Аноним'}</span>
            <span className="font-mono text-xs text-muted-foreground">@{contact.anonymous_id}</span>
          </div>
          {isTyping ? (
            <TypingIndicator />
          ) : contact.status ? (
            <p className="text-sm text-muted-foreground truncate">{contact.status}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {contact.is_online ? 'онлайн' : 'не в сети'}
            </p>
          )}
        </div>
      </button>
      
      <AnimatePresence>
        {showDelete && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => { onDelete(contact.anonymous_id); setShowDelete(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-destructive text-white rounded-full"
            data-testid={`delete-contact-${contact.anonymous_id}`}
          >
            <Trash2 size={18} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Pages
const ChatList = () => {
  const { user, contacts, setCurrentChat, setContacts, typingUsers, onlineUsers } = useUser();
  const navigate = useNavigate();
  
  const handleContactClick = (contact) => {
    setCurrentChat(contact);
    navigate('/chat');
  };
  
  const handleDeleteContact = async (anonymousId) => {
    try {
      await axios.delete(`${API}/contacts/${anonymousId}?telegram_id=${user.telegram_id}`);
      setContacts(prev => prev.filter(c => c.anonymous_id !== anonymousId));
      toast.success('Контакт удалён');
    } catch (err) {
      toast.error('Ошибка удаления');
    }
  };
  
  // Update contacts with online status
  const contactsWithStatus = contacts.map(c => ({
    ...c,
    is_online: onlineUsers.includes(c.anonymous_id)
  }));
  
  return (
    <div className="min-h-screen bg-background pb-20 pt-14">
      <Header title="GhostChat" />
      
      <div className="max-w-md mx-auto p-3">
        {user && (
          <div className="mb-4 p-3 bg-card rounded-lg border border-border">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Ваш ID:</span>
              <span className="font-mono text-primary font-medium">@{user.anonymous_id}</span>
            </div>
          </div>
        )}
        
        {contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <MessageSquare size={32} className="text-muted-foreground" />
            </div>
            <p className="text-muted-foreground mb-2">Нет контактов</p>
            <p className="text-sm text-muted-foreground">Найдите собеседника через поиск</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground px-3 mb-2">Удержите контакт для удаления</p>
            {contactsWithStatus.map((contact) => (
              <ContactItem
                key={contact.anonymous_id}
                contact={contact}
                onClick={() => handleContactClick(contact)}
                onDelete={handleDeleteContact}
                typingUsers={typingUsers}
              />
            ))}
          </div>
        )}
      </div>
      
      <BottomNav active="chats" />
    </div>
  );
};

const ChatDetail = () => {
  const { user, currentChat, typingUsers, onlineUsers } = useUser();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  
  const isTyping = typingUsers.includes(currentChat?.anonymous_id);
  const isOnline = onlineUsers.includes(currentChat?.anonymous_id);
  
  useEffect(() => {
    if (!currentChat) {
      navigate('/');
      return;
    }
  }, [currentChat, navigate]);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Handle incoming messages
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.detail?.type === 'message' && event.detail?.sender_id === currentChat?.anonymous_id) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: event.detail.text,
          sender_id: event.detail.sender_id,
          timestamp: event.detail.timestamp,
          isMine: false
        }]);
      }
    };
    
    window.addEventListener('ws-message', handleMessage);
    return () => window.removeEventListener('ws-message', handleMessage);
  }, [currentChat]);
  
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    
    // Send typing indicator (throttled)
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      sendWsMessage('typing', { recipient_id: currentChat.anonymous_id, is_typing: true });
      lastTypingSentRef.current = now;
    }
    
    // Clear previous timeout
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    // Set timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      sendWsMessage('typing', { recipient_id: currentChat.anonymous_id, is_typing: false });
    }, 3000);
  };
  
  const handleSend = () => {
    if (!inputText.trim() || !currentChat) return;
    
    // Clear typing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      sendWsMessage('typing', { recipient_id: currentChat.anonymous_id, is_typing: false });
    }
    
    const newMessage = {
      id: Date.now().toString(),
      text: inputText.trim(),
      sender_id: user.anonymous_id,
      timestamp: new Date().toISOString(),
      isMine: true
    };
    
    setMessages(prev => [...prev, newMessage]);
    sendWsMessage('message', { recipient_id: currentChat.anonymous_id, text: inputText.trim() });
    setInputText('');
  };
  
  if (!currentChat) return null;
  
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        title={
          <div className="flex flex-col">
            <span>{currentChat.name || `@${currentChat.anonymous_id}`}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {isTyping ? 'печатает...' : isOnline ? 'онлайн' : 'не в сети'}
            </span>
          </div>
        }
        showBack
        onBack={() => navigate('/')}
      />
      
      <div className="flex-1 overflow-y-auto pt-14 pb-20 px-3">
        <div className="max-w-md mx-auto py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground text-sm">Начните переписку</p>
              <p className="text-xs text-muted-foreground mt-1">Сообщения не сохраняются</p>
            </div>
          ) : (
            messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.isMine ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] px-4 py-2 ${msg.isMine ? 'bubble-me' : 'bubble-other'}`}>
                  <p className="text-sm break-words">{msg.text}</p>
                  <p className={`text-[10px] mt-1 ${msg.isMine ? 'text-white/70' : 'text-muted-foreground'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </motion.div>
            ))
          )}
          
          {isTyping && (
            <div className="flex justify-start">
              <div className="bubble-other px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>
      
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-3 safe-area-bottom">
        <div className="max-w-md mx-auto flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Сообщение..."
            className="flex-1 h-10 px-4 bg-input rounded-full border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="chat-input"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-50 transition-opacity"
            data-testid="send-button"
          >
            <SendHorizontal size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

const SearchPage = () => {
  const { user, contacts, setContacts } = useUser();
  const [searchId, setSearchId] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleSearch = async () => {
    if (!searchId.trim() || searchId.length !== 7) {
      setError('Введите 7-значный ID');
      return;
    }
    
    setLoading(true);
    setError('');
    setSearchResult(null);
    
    try {
      const response = await axios.get(`${API}/user/search?anonymous_id=${searchId}`);
      setSearchResult(response.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('Пользователь не найден');
      } else {
        setError('Ошибка поиска');
      }
    } finally {
      setLoading(false);
    }
  };
  
  const handleAddContact = async () => {
    if (!searchResult || !user) return;
    
    try {
      await axios.post(`${API}/contacts/add?telegram_id=${user.telegram_id}`, {
        target_anonymous_id: searchResult.anonymous_id
      });
      
      setContacts(prev => [searchResult, ...prev.filter(c => c.anonymous_id !== searchResult.anonymous_id)]);
      toast.success('Контакт добавлен');
      setSearchResult(null);
      setSearchId('');
    } catch (err) {
      if (err.response?.data?.detail === 'Contact already added') {
        toast.error('Контакт уже добавлен');
      } else if (err.response?.data?.detail === 'Cannot add yourself') {
        toast.error('Нельзя добавить себя');
      } else {
        toast.error('Ошибка добавления');
      }
    }
  };
  
  const isAlreadyContact = searchResult && contacts.some(c => c.anonymous_id === searchResult.anonymous_id);
  const isSelf = searchResult && user && searchResult.anonymous_id === user.anonymous_id;
  
  return (
    <div className="min-h-screen bg-background pb-20 pt-14">
      <Header title="Поиск" />
      
      <div className="max-w-md mx-auto p-4">
        <div className="mb-6">
          <label className="block text-sm text-muted-foreground mb-2">Введите ID пользователя</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value.replace(/\D/g, '').slice(0, 7))}
                placeholder="1234567"
                className="w-full h-10 pl-8 pr-4 bg-input rounded-lg border border-border font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="search-input"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || searchId.length !== 7}
              className="h-10 px-4 bg-primary text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-opacity"
              data-testid="search-button"
            >
              {loading ? '...' : 'Найти'}
            </button>
          </div>
          {error && <p className="text-destructive text-sm mt-2">{error}</p>}
        </div>
        
        <AnimatePresence>
          {searchResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-card rounded-lg border border-border p-4"
              data-testid="search-result"
            >
              <div className="flex items-center gap-4">
                <Avatar 
                  name={searchResult.name} 
                  avatarUrl={searchResult.avatar_url} 
                  size="lg" 
                  gender={searchResult.gender}
                  isOnline={searchResult.is_online}
                />
                <div className="flex-1">
                  <h3 className="font-heading font-semibold text-lg">{searchResult.name || 'Аноним'}</h3>
                  <p className="font-mono text-sm text-primary">@{searchResult.anonymous_id}</p>
                  {searchResult.status && (
                    <p className="text-sm text-muted-foreground mt-1">{searchResult.status}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {searchResult.is_online ? '🟢 онлайн' : '⚪ не в сети'}
                  </p>
                </div>
              </div>
              
              {!isSelf && (
                <button
                  onClick={handleAddContact}
                  disabled={isAlreadyContact}
                  className={`w-full mt-4 h-10 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                    isAlreadyContact
                      ? 'bg-muted text-muted-foreground cursor-not-allowed'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                  data-testid="add-contact-button"
                >
                  {isAlreadyContact ? (
                    <>
                      <Check size={18} />
                      В контактах
                    </>
                  ) : (
                    <>
                      <UserPlus size={18} />
                      Добавить в контакты
                    </>
                  )}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      <BottomNav active="search" />
    </div>
  );
};

const ProfilePage = () => {
  const { user, setUser } = useUser();
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    status: '',
    gender: '',
    avatar_url: '',
    notifications_enabled: true
  });
  const [saving, setSaving] = useState(false);
  
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        status: user.status || '',
        gender: user.gender || '',
        avatar_url: user.avatar_url || '',
        notifications_enabled: user.notifications_enabled
      });
    }
  }, [user]);
  
  const handleSave = async () => {
    if (!user) return;
    
    setSaving(true);
    try {
      const response = await axios.put(`${API}/user/me?telegram_id=${user.telegram_id}`, formData);
      setUser(response.data);
      setEditing(false);
      toast.success('Профиль сохранён');
    } catch (err) {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };
  
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Загрузка...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background pb-20 pt-14">
      <Header
        title="Профиль"
        rightAction={
          editing ? (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-muted-foreground" data-testid="cancel-edit">
                <X size={24} />
              </button>
              <button onClick={handleSave} disabled={saving} className="text-primary" data-testid="save-profile">
                <Check size={24} />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground" data-testid="edit-profile">
              <Edit2 size={20} />
            </button>
          )
        }
      />
      
      <div className="max-w-md mx-auto p-4">
        <div className="flex flex-col items-center mb-6">
          <div className="relative mb-4">
            <Avatar 
              name={formData.name || user.name} 
              avatarUrl={formData.avatar_url || user.avatar_url} 
              size="lg" 
              gender={formData.gender || user.gender} 
            />
            {editing && (
              <button className="absolute bottom-0 right-0 w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                <Edit2 size={14} />
              </button>
            )}
          </div>
          
          <div className="text-center">
            <p className="font-mono text-xl text-primary font-medium" data-testid="user-id">@{user.anonymous_id}</p>
            <p className="text-xs text-muted-foreground mt-1">Ваш анонимный ID</p>
          </div>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Имя</label>
            {editing ? (
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Введите имя"
                className="w-full h-10 px-4 bg-input rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="name-input"
              />
            ) : (
              <p className="text-foreground">{user.name || 'Не указано'}</p>
            )}
          </div>
          
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Статус</label>
            {editing ? (
              <input
                type="text"
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                placeholder="Введите статус"
                className="w-full h-10 px-4 bg-input rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="status-input"
              />
            ) : (
              <p className="text-foreground">{user.status || 'Не указано'}</p>
            )}
          </div>
          
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Пол</label>
            {editing ? (
              <div className="flex gap-2">
                {[
                  { value: 'male', label: 'Мужской' },
                  { value: 'female', label: 'Женский' },
                  { value: '', label: 'Не указывать' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setFormData(prev => ({ ...prev, gender: option.value }))}
                    className={`flex-1 h-10 rounded-lg text-sm font-medium transition-colors ${
                      formData.gender === option.value
                        ? 'bg-primary text-white'
                        : 'bg-input border border-border text-foreground hover:bg-card'
                    }`}
                    data-testid={`gender-${option.value || 'none'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-foreground">
                {user.gender === 'male' ? 'Мужской' : user.gender === 'female' ? 'Женский' : 'Не указано'}
              </p>
            )}
          </div>
          
          {editing && (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">URL аватара</label>
              <input
                type="url"
                value={formData.avatar_url}
                onChange={(e) => setFormData(prev => ({ ...prev, avatar_url: e.target.value }))}
                placeholder="https://..."
                className="w-full h-10 px-4 bg-input rounded-lg border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="avatar-input"
              />
            </div>
          )}
          
          <div className="flex items-center justify-between py-3 border-t border-border">
            <div className="flex items-center gap-3">
              <Bell size={20} className="text-muted-foreground" />
              <span>Уведомления</span>
            </div>
            <button
              onClick={() => editing && setFormData(prev => ({ ...prev, notifications_enabled: !prev.notifications_enabled }))}
              className={`w-12 h-6 rounded-full transition-colors relative ${
                (editing ? formData.notifications_enabled : user.notifications_enabled)
                  ? 'bg-primary'
                  : 'bg-muted'
              }`}
              disabled={!editing}
              data-testid="notifications-toggle"
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  (editing ? formData.notifications_enabled : user.notifications_enabled)
                    ? 'left-7'
                    : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
      
      <BottomNav active="profile" />
    </div>
  );
};

// App Provider
const AppProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [currentChat, setCurrentChat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  
  useEffect(() => {
    const initApp = async () => {
      const tg = getTelegram();
      
      if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor('#050505');
        tg.setBackgroundColor('#050505');
      }
      
      let telegramId = tg?.initDataUnsafe?.user?.id?.toString();
      
      if (!telegramId) {
        telegramId = localStorage.getItem('ghostchat_telegram_id');
        if (!telegramId) {
          telegramId = `dev_${Date.now()}`;
          localStorage.setItem('ghostchat_telegram_id', telegramId);
        }
      }
      
      try {
        const authResponse = await axios.post(`${API}/auth/telegram`, {
          telegram_id: telegramId,
          init_data: tg?.initData || ''
        });
        
        setUser(authResponse.data);
        
        const contactsResponse = await axios.get(`${API}/contacts?telegram_id=${telegramId}`);
        setContacts(contactsResponse.data);
        
        // Get initial online users
        try {
          const onlineResponse = await axios.get(`${API}/online`);
          setOnlineUsers(onlineResponse.data.online || []);
        } catch (e) {
          console.log('Failed to get online users');
        }
        
        connectWebSocket(authResponse.data.anonymous_id, (data) => {
          if (data.type === 'message') {
            // Dispatch custom event for ChatDetail
            window.dispatchEvent(new CustomEvent('ws-message', { detail: data }));
            toast(`Сообщение от @${data.sender_id}`, { description: data.text });
          } else if (data.type === 'typing') {
            if (data.is_typing) {
              setTypingUsers(prev => [...prev.filter(id => id !== data.sender_id), data.sender_id]);
            } else {
              setTypingUsers(prev => prev.filter(id => id !== data.sender_id));
            }
          } else if (data.type === 'status') {
            if (data.status === 'online') {
              setOnlineUsers(prev => [...prev.filter(id => id !== data.user_id), data.user_id]);
            } else {
              setOnlineUsers(prev => prev.filter(id => id !== data.user_id));
            }
          }
        });
        
      } catch (err) {
        console.error('Init error:', err);
        toast.error('Ошибка инициализации');
      } finally {
        setLoading(false);
      }
    };
    
    initApp();
    
    return () => {
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      if (pingInterval) clearInterval(pingInterval);
      if (ws) ws.close();
    };
  }, []);
  
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center animate-pulse">
            <MessageSquare size={32} className="text-primary" />
          </div>
          <p className="text-muted-foreground">Загрузка GhostChat...</p>
        </div>
      </div>
    );
  }
  
  return (
    <UserContext.Provider value={{ 
      user, setUser, 
      contacts, setContacts, 
      currentChat, setCurrentChat, 
      typingUsers, onlineUsers 
    }}>
      {children}
    </UserContext.Provider>
  );
};

function App() {
  return (
    <div className="App">
      <Toaster position="top-center" theme="dark" richColors />
      <BrowserRouter>
        <AppProvider>
          <AnimatePresence mode="wait">
            <Routes>
              <Route path="/" element={<ChatList />} />
              <Route path="/chat" element={<ChatDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Routes>
          </AnimatePresence>
        </AppProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;