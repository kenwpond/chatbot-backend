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
          content: `You are a friendly, conversational AI assistant for a technical tutorial. Your goal is to help users by providing clear, concise answers. Use the following context to answer the user's question. Rephrase the context in a natural, helpful way. Do NOT mention the word 'context' or refer to your source material (e.g., do not say 'as mentioned in the transcript'). Just provide a direct, friendly answer. CONTEXT: "${context}"`
        },
        {
          role: "user",
          content: question
        }
      ]
    });
    const answer = completion.choices[0].message.content;
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
