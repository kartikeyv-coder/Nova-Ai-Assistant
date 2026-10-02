import React from 'react';
import HologramCore from './Components/Hologram';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { useContext } from 'react';
import { Data_Context } from './Context/UserContext';

const genAi = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);

export async function askGemini(promptText) {
  try {
    const model = genAi.getGenerativeModel({ model: 'gemini-3.5-flash-lite' ,
      // generationConfig:{
      //   maxOutputTokens: 100
      // }
    });
    const result = await model.generateContent(promptText);
    return result.response.text();
  } catch (e) {
    console.error('Gemini API Error:', e);
    throw e;
  }
}

const App = () => {

  return (
    <div>
      <HologramCore />
      
    </div>
  );
};

export default App;