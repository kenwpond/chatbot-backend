// server.js -> inside the app.post('/api/chat', ...) function

// ... (keep all the code above this)

  // 2. Make a LIVE call to the OpenAI API
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          // --- NEW, IMPROVED PROMPT ---
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
    res.json({ answer: answer });

// ... (keep all the code below this)
