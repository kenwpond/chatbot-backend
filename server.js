// server.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- CORS: Restrict to your domain ---
app.use(cors({
  origin: "https://dataforyourbeta.com",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.options('*', cors());
app.use(express.json());

// --- Load and parse both JSON data files ONCE ---
const stepsPath = path.resolve("./rag_data.json");
const transcriptPath = path.resolve("./transcript.json");

let stepData = [];
let transcriptData = "";

// Load steps (RAG)
try {
  stepData = JSON.parse(fs.readFileSync(stepsPath, "utf-8"));
  if (!Array.isArray(stepData)) throw new Error("rag_data.json is not an array");
} catch (err) {
  console.error("FATAL: Could not load rag_data.json:", err);
  stepData = [];
}

// Load transcript (best practices)
try {
  const parsed = JSON.parse(fs.readFileSync(transcriptPath, "utf-8"));
  // Support plain text or { text: "...", ... }
  if (typeof parsed === "string") {
    transcriptData = parsed;
  } else if (parsed.text) {
    transcriptData = parsed.text;
  } else {
    // If object, use the first string value found, else JSON-stringify the object
    transcriptData =
      Object.values(parsed).find(v => typeof v === "string") ||
      JSON.stringify(parsed);
  }
} catch (err) {
  console.error("WARNING: Could not load transcript.json:", err);
  transcriptData = "";
}

// --- Utility: Format step references as clickable links ---
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

// --- Utility: Compose context for AI (first N steps + transcript summary) ---
function getGeneralContext(stepCount = 3) {
  let steps = stepData
    .slice(0, stepCount)
    .map(obj => `Step ${obj.step}: ${obj.guidance}`)
    .join('\n\n');
  let transcript = transcriptData
    ? `\n\nTranscript Best Practices and Explanations:\n${transcriptData.slice(0, 2000)}...`
    : "";
  return `${steps}${transcript}`;
}

// --- Health check route ---
app.get("/", (req, res) => {
  res.send("Chatbot backend is running.");
});

// --- Transcript API route (returns full transcript) ---
app.get("/api/transcript", (req, res) => {
  res.json({ transcript: transcriptData });
});

// --- Main Chatbot endpoint ---
app.post("/api/chat", async (req, res) => {
  const { question, history } = req.body;
  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  const context = getGeneralContext(3); // adjust if you want more/less context

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let systemPrompt = `
You are a friendly, conversational AI assistant for a technical tutorial and onboarding system. Your goal is to help users by providing clear, concise answers that blend step-by-step instructions with expert best-practices.

When referring to steps, group consecutive steps into ranges (e.g., 52–59) and provide clickable links for each step using the format <a href="#step-52">Step 52</a> or <a href="#step-52">Steps 52–59</a>.
Do NOT mention the word 'context' or refer to your source material (e.g., do not say 'as mentioned in the transcript'). Just provide a direct, friendly answer.

Here are key steps and guidance from the workflow, plus expert explanations for best practices. Paraphrase and be helpful:

${context}
`;

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
