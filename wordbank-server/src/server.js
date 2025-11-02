import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

// 新增词汇（若包含空格则不调用词典API）
app.post('/words', async (req, res) => {
  const { word, cn } = req.body || {};
  if (!word || !word.trim()) return res.status(400).json({ ok: false, error: 'word required' });
  const data = readWords();
  const item = { word: String(word).trim(), cn: String(cn||'').trim(), createdAt: Date.now() };
  data.words.push(item);
  writeWords(data);
  res.json({ ok: true, item });
});

// 删除词汇
app.delete('/words', (req, res) => {
  const { word } = req.body || {};
  const data = readWords();
  data.words = data.words.filter(w => w.word !== String(word||'').trim());
  writeWords(data);
  res.json({ ok: true });
});

const port = process.env.PORT || 6100;
app.listen(port, () => console.log(`[wordbank-server] listening on :${port}`));