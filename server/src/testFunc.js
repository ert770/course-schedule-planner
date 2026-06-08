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
  
  const res = await chat.sendMessage("search cats");
  console.log('functionCalls', res.functionCalls);

  try {
    const res2 = await chat.sendMessage([{ 
      functionResponse: { name: "search", response: { result: "found cats!" } } 
    }]);
    console.log(res2.text);
  } catch(e) {
    console.error("test 1 failed", e.message);
    try {
      const res3 = await chat.sendMessage({ 
        role: "user", parts: [{ functionResponse: { name: "search", response: { result: "found cats!" } } }] 
      });
      console.log(res3.text);
    } catch(e2) {
      console.error("test 2 failed", e2.message);
    }
  }
};
test().catch(console.error);
