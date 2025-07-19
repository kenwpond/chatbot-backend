import express from 'express';
import 'dotenv/config';

const app = express();
const port = 3000;

app.use(express.static('public'));

app.get('/api/get-token', async (req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching ephemeral key:", error);
    res.status(500).json({ error: 'Failed to get token' });
  }
});

app.listen(port, () => {
  console.log(`Server is ready at http://localhost:${port}`);
});
