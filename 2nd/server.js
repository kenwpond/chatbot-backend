// server.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";

// --- Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- CORS setup for your frontend
app.use(cors({
  origin: "https://dataforyourbeta.com",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.options('*', cors());
app.use(express.json());

// --- Use the correct base path for your files:
const BASE_PATH = path.resolve("chatbot-backend/2nd");
const stepsPath = path.join(BASE_PATH, "rag_data.json");
const transcriptPath = path.join(BASE_PATH, "transcript.json");
// const sectionsPath = path.join(BASE_PATH, "sections.json");
// const captionsPath = path.join(BASE_PATH, "captions.json");
// const framesIndexPath = path.join(BASE_PATH, "frames_index.json");

let stepData = [];
let transcriptData = "";

// --- Load Steps Data ---
try {
  stepData = JSON.parse(fs.readFileSync(stepsPath, "utf-8"));
  if (!Array.isArray(stepData)) throw new Error("rag_data.json is not an array");
} catch (err) {
  console.error("FATAL: Could not load rag_data.json:", err);
  stepData = [];
}

// --- Load Transcript Data ---
try {
  const parsed = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
  if (typeof parsed === "string") {
    transcriptData = parsed;
  } else if (parsed.text) {
    transcriptData = parsed.text;
  } else {
    transcriptData =
      Object.values(parsed).find(v => typeof v === "string") ||
      JSON.stringify(parsed);
  }
} catch (err) {
  console.error("WARNING: Could not load transcript.json:", err);
  transcriptData = "";
}

// --- Format step references as clickable links ---
function formatStepsInAnswer(answer) {
  const matches = Array.from(answer.matchAll(/Step\s+(\d+)/gi));
  const stepNums = matches.map(m => parseInt(m[1], 10));
  if (stepNums.length === 0) return answer;
  const uniqueSteps = [...new Set(stepNums)].sort((a, b) => a - b);

  let ranges = [], start = uniqueSteps[0], end = uniqueSteps[0];
  for (let i = 1; i < uniqueSteps.length; i++) {
    if (uniqueSteps[i] === end + 1) {
      end = uniqueSteps[i];
    } else {
      ranges.push([start, end]);
      start = end = uniqueSteps[i];
    }
  }
  ranges.push([start, end]);
  let links = ranges.map(([s, e]) =>
    s === e
      ? `<a href="#step-${s}">Step ${s}</a>`
      : `<a href="#step-${s}">Steps ${s}–${e}</a>`
  );
  let linksStr = "";
  if (links.length === 1) {
    linksStr = links[0];
  } else if (links.length === 2) {
    linksStr = links.join(" and ");
  } else {
    linksStr = links.slice(0, -1).join(", ") + ", and " + links[links.length - 1];
  }
  if (/steps? that deal/i.test(answer)) {
    return `Mail merge is covered in: ${linksStr}`;
  }
  return `${answer}<br><br>Relevant steps: ${linksStr}`;
}

// --- Get relevant steps for a question ---
function getRelevantSteps(question, maxSteps = 4) {
  if (!question || !stepData.length) return [];
  const q = question.toLowerCase();

  // Prefer direct step number match (e.g., "step 17")
  let stepNumMatch = q.match(/step\s*(\d+)/i);
  if (stepNumMatch) {
    let snum = parseInt(stepNumMatch[1], 10);
    let stepObj = stepData.find(s => String(s.step) === String(snum));
    return stepObj ? [stepObj] : [];
  }

  // Otherwise: score by keyword overlap in guidance
  let scored = stepData.map(obj => {
    let g = (obj.guidance || "").toLowerCase();
    let score = 0;
    for (let word of q.split(/\W+/)) {
      if (!word || word.length < 3) continue;
      if (g.includes(word)) score += 1;
    }
    if (g.includes("mail merge") && q.includes("mail merge")) score += 2;
    if (g.includes("filter") && q.includes("filter")) score += 2;
    return { ...obj, score };
  }).sort((a, b) => b.score - a.score);

  let matches = scored.filter(s => s.score > 0).slice(0, maxSteps);
  if (matches.length === 0) matches = stepData.slice(0, maxSteps);
  return matches;
}

// --- Get relevant transcript snippet ---
function getRelevantTranscript(question, snippetChars = 1200) {
  if (!transcriptData) return "";
  let lcTranscript = transcriptData.toLowerCase();
  let lcQ = question.toLowerCase();

  let words = lcQ.split(/\W+/).filter(w => w.length > 3);
  let idx = -1;
  for (let w of words) {
    idx = lcTranscript.indexOf(w);
    if (idx !== -1) break;
  }
  if (idx === -1) idx = 0;

  let start = Math.max(0, idx - 100);
  let end = Math.min(lcTranscript.length, idx + snippetChars);
  return transcriptData.slice(start, end) + (end < transcriptData.length ? "..." : "");
}

// --- Health check ---
app.get("/", (req, res) => {
  res.send("Chatbot backend is running.");
});

// --- Return the full transcript ---
app.get("/api/transcript", (req, res) => {
  res.json({ transcript: transcriptData });
});

// --- Main Chatbot endpoint ---
app.post("/api/chat", async (req, res) => {
  const { question, history } = req.body;
  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  // Compose the context for OpenAI
  const relevantSteps = getRelevantSteps(question, 4);
  const stepsContext = relevantSteps
    .map(obj => `Step ${obj.step}: ${obj.guidance}`)
    .join('\n\n');
  const transcriptContext = getRelevantTranscript(question, 1200);

  let systemPrompt = `
You are a friendly, conversational AI assistant for a technical tutorial and onboarding system. Your goal is to help users by providing clear, concise answers that blend step-by-step instructions with expert best-practices.

When referring to steps, group consecutive steps into ranges (e.g., 52–59) and provide clickable links for each step using the format <a href="#step-52">Step 52</a> or <a href="#step-52">Steps 52–59</a>.
Do NOT mention the word 'context' or refer to your source material (e.g., do not say 'as mentioned in the transcript'). Just provide a direct, friendly answer.

Here are the most relevant steps and best practices for this question:

${stepsContext}

Expert explanation or tips:

${transcriptContext}
`;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let messages = [{ role: "system", content: systemPrompt }];
    if (Array.isArray(history)) {
      messages = messages.concat(history);
    }
    if (
      !history ||
      history.length === 0 ||
      history[history.length - 1].role !== "user" ||
      history[history.length - 1].content !== question
    ) {
      messages.push({ role: "user", content: question });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages
    });

    let answer = completion.choices[0].message.content;
    answer = formatStepsInAnswer(answer);

    res.json({ answer });
  } catch (err) {
    console.error("OpenAI API Error:", err);
    res.status(500).json({ error: "AI backend error: " + (err.message || "Unknown error") });
  }
});

// --- Start the server ---
app.listen(port, () => {
  console.log(`🔥 Ken's Chatbot Server listening on port ${port}`);
});
