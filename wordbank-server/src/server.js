import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 静态前端
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pubDir = path.join(__dirname, '..', 'public');
try { app.use(express.static(pubDir)); } catch {}

const dataDir = path.resolve(process.cwd(), 'wordbank-server', 'data');
const wordsFile = path.join(dataDir, 'words.json');
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(wordsFile)) fs.writeFileSync(wordsFile, JSON.stringify({ words: [] }, null, 2));

const readWords = () => { try { return JSON.parse(fs.readFileSync(wordsFile, 'utf-8')); } catch { return { words: [] }; } };
const writeWords = (data) => { try { fs.writeFileSync(wordsFile, JSON.stringify(data, null, 2)); return true; } catch { return false; } };

// 健康检查
app.get('/health', (_req, res) => res.json({ ok: true }));

// 查询全部
app.get('/words', (_req, res) => { res.json(readWords()); });

// 新增词汇（不持久化词典原始数据以节省空间）
app.post('/words', requireEditKey, async (req, res) => {
  const { word, cn, translations } = req.body || {};
  if (!word || !word.trim()) return res.status(400).json({ ok: false, error: 'word required' });
  const data = readWords();
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, word: String(word).trim(), cn: String(cn||'').trim(), createdAt: Date.now() };
  // 规范化前端传入的词性翻译数组
  if (Array.isArray(translations)) {
    item.translations = translations.map((t) => ({ pos: String(t?.pos || '').trim(), cn: String(t?.cn || t?.tran_cn || '').trim() })).filter((x) => x.cn);
  }
  // 不保存 dict 字段，避免 words.json 体积膨胀；如需词典，请在客户端按需调用并选择译文写入 translations
  data.words.push(item);
  writeWords(data);
  res.json({ ok: true, item });
});

// 删除词汇（优先按ID删除；若无ID则按单词删除一条，优先最新）
app.delete('/words', requireEditKey, (req, res) => {
  const { id, word } = req.body || {};
  const data = readWords();
  let removed = null;
  const idStr = String(id || '').trim();
  if (idStr) {
    const idx = data.words.findIndex((w) => String(w.id || '') === idStr);
    if (idx >= 0) removed = data.words.splice(idx, 1)[0];
  } else {
    const normWord = String(word || '').trim();
    if (normWord) {
      const candidates = data.words.map((w, i) => ({ w, i })).filter((x) => String(x.w.word || '') === normWord);
      if (candidates.length) {
        candidates.sort((a, b) => (b.w.createdAt || 0) - (a.w.createdAt || 0));
        removed = data.words.splice(candidates[0].i, 1)[0];
      }
    }
  }
  writeWords(data);
  res.json({ ok: true, removed });
});

const port = process.env.PORT || 6100;
app.listen(port, () => console.log(`[wordbank-server] listening on :${port}`));
// 简单编辑密钥（仅用于编辑操作：添加、删除）
const EDIT_KEY = process.env.WORDBANK_EDIT_KEY || 'lesson';
function requireEditKey(req, res, next) {
  const k = String(req.headers['x-edit-key'] || '').trim();
  if (!EDIT_KEY) return next(); // 若未设置密钥则不校验
  if (k && k === EDIT_KEY) return next();
  return res.status(403).json({ ok: false, error: 'forbidden: invalid edit key' });
}