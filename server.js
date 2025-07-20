// server.js

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import fs from "fs";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- CORS setup: only allow your site in production ---
app.use(cors({
  origin: "https://dataforyourbeta.com", // Allow ONLY your front-end domain
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.options('*', cors()); // Handle preflight OPTIONS

app.use(express.json());

// --- Health check route ---
app.get("/", (req, res) => {
  res.send("Chatbot backend is running.");
});

// --- Utility to format step numbers into ranges and clickable links ---
function formatStepsInAnswer(answer) {
  // Match all step numbers in the answer text (e.g., "Step 52", "Step 53")
  const matches = Array.from(answer.matchAll(/Step\s+(\d+)/gi));
  const stepNums = matches.map(m => parseInt(m[1], 10));
  if (stepNums.length === 0) return answer; // No steps detected, return as-is

  // Remove duplicates and sort
  const uniqueSteps = [...new Set(stepNums)].sort((a, b) => a - b);

  // Turn step numbers into ranges
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

  // Build linkified, grouped response (using "and" before the last range)
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

  // If the original answer starts with "Steps that deal with..." or similar, replace it
  if (/steps? that deal/i.test(answer)) {
    return `Mail merge is covered in: ${linksStr}`;
  }
  // Otherwise, append at the end (or adjust this logic as needed)
  return `${answer}<br><br>Relevant steps: ${linksStr}`;
}

// --- Main chatbot API endpoint ---
app.post("/api/chat", async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: "No question provided" });
  }

  // Load your RAG context (optional, adjust path as needed)
  let context = "";
  try {
    context = fs.readFileSync("./rag_data.json", "utf-8");
  } catch (err) {
    context = "No RAG context loaded.";
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a friendly, conversational AI assistant for a technical tutorial. Your goal is to help users by providing clear, concise answers. Use the following context to answer the user's question. Rephrase the context in a natural, helpful way. 
When referring to steps, group consecutive steps into ranges (e.g., 52–59) and provide clickable links for each step using the format <a href="#step-52">Step 52</a> or <a href="#step-52">Steps 52–59</a>.
Do NOT mention the word 'context' or refer to your source material (e.g., do not say 'as mentioned in the transcript'). Just provide a direct, friendly answer. CONTEXT: "${context}"`
        },
        {
          role: "user",
          content: question
        }
      ]
    });
    let answer = completion.choices[0].message.content;

    // --- Post-process answer to format steps as ranges and clickable links ---
    answer = formatStepsInAnswer(answer);

    res.json({ answer });
  } catch (err) {
    // Print full error to Render logs
    console.error("OpenAI API Error:", err);
    res.status(500).json({ error: "AI backend error: " + (err.message || "Unknown error") });
  }
});

// --- Start server ---
app.listen(port, () => {
  console.log(`🔥 Ken's Chatbot Server listening on port ${port}`);
});
