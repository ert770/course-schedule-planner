import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const test = async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const chat = ai.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      tools: [{
        functionDeclarations: [{
          name: "search",
          description: "search",
          parameters: { type: "OBJECT", properties: { q: { type: "STRING" } } }
        }]
      }]
    }
  });

  await chat.sendMessage({ message: "search cats" });

  try {
    const r = await chat.sendMessage({ message: [{ functionResponse: { name: "search", response: { result: "cats" } } }] });
    console.log("SUCCESS!", r.text);
  } catch(e) {
    console.error("FAIL!", e.message);
  }
};
test().catch(console.error);
