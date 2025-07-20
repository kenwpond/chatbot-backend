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

// --- CORS: restrict to your domain ---
app.use(cors({
  origin: "https://dataforyourbeta.com", // Update as needed
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.options('*', cors());
app.use(express.json());

// --- Load and parse RAG data (steps) ONCE ---
const ragPath = path.resolve("./rag_data.json");
let stepData = [];
try {
  stepData = JSON.parse(fs.readFileSync(ragPath, "utf-8"));
  if (!Array.isArray(stepData)) throw new Error("rag_data.json does not contain an array");
} catch (err) {
  console.error("FATAL: Could not load rag_data.json:", err);
  stepData = [];
}

// --- Utility: Linkify step numbers into HTML clickable ranges ---
function formatStepsInAnswer(answer) {
  const matches = Array.from(answer.matchAll(/Step\s+(\d+)/gi));
  const stepNums = matches.map(m => parseInt(m[1], 10));
  if (stepNums.length === 0) return answer;
  const uniqueSteps = [...new Set(stepNums)].sort((a, b) => a - b);

  // Turn step numbers into ranges (52,53,54 -> 52–54)
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

// --- Utility: get general context for the prompt ---
// (NO stepContext awareness anymore! Just sends the first 3 steps as context. You can adjust this if you want.)
function getGeneralContext(count = 3) {
  return stepData
    .slice(0, count)
    .map(obj => `Step ${obj.step}: ${obj.guidance}`)
    .join('\n\n');
}

// --- Health check route ---
app.get("/", (req, res) => {
  res.send("Chatbot backend is running.");
});

// --- Chatbot endpoint ---
app.post("/api/chat", async (req, res) => {
  const { question, history } = req.body;
  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  // --- General context only, no stepContext ---
  const context = getGeneralContext(3); // Send first 3 steps (adjust if needed)

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    let systemPrompt = `
You are a friendly, conversational AI assistant for a technical tutorial. Your goal is to help users by providing clear, concise answers.

When referring to steps, group consecutive steps into ranges (e.g., 52–59) and provide clickable links for each step using the format <a href="#step-52">Step 52</a> or <a href="#step-52">Steps 52–59</a>.
Do NOT mention the word 'context' or refer to your source material (e.g., do not say 'as mentioned in the transcript'). Just provide a direct, friendly answer.

Here are some steps from the guide (paraphrase and be helpful):

${context}
`;

    let messages = [
      { role: "system", content: systemPrompt }
    ];
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
