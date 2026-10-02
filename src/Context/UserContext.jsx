import React, { createContext, useRef, useState } from 'react';
import { resume } from 'react-dom/server';
import { askGemini } from '../App';
export const Data_Context = createContext();

const UserContext = ({ children }) => {

    const command = {
        youtube: "https://www.youtube.com",
        whatsapp: "https://web.whatsapp.com",
        gmail: "https://mail.google.com",
        maps: "https://maps.google.com",
        chatgpt: "https://chatgpt.com",
         leetcode: "https://leetcode.com",
    };

    const handlecommand = (text) => {
        const t = text.toLowerCase().trim();

        /**
         * Playing something on Youtube
         */

        const yt = t.match(
            /^(?:play|search|find)\s+(.+?)(?:\s+on\s+youtube)?$/
        )

        if(yt){
            const query = yt[1].trim();

            Speak(`Speaking Youtube for ${query}`)

            const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

            window.open( url, "_blank");

            return true;
        }

        const match = t.match(/\b(?:open|launch|go to|visit)\s+(.+?)(?:\s+(?:for me|please|website|site))*$/);
        if (!match) return false;

        const name = match[1].replace(/\s+/g, "");

        let url;
        if (command[name]) {
            url = command[name];
        } else if (/\.\w{2,}$/.test(name)) {
            url = `https://${name}`;
        } else {
            url = `https://www.${name}.com`;
        }

        Speak(`Opening ${match[1]}`);
        window.open(url, "_blank");
        return true;
    }

    const [spokenText, setSpokenTest] = useState('')
    const speakId = useRef(0)
    const clearTimer = useRef(null)

    // FIX 4a: keep voices in a ref so they survive re-renders
    const Voices = useRef([]);
    const Voices_Load = () => {
        Voices.current = window.speechSynthesis.getVoices();
    }

    Voices_Load();

    window.speechSynthesis.onvoiceschanged = Voices_Load;

    // Choosing the Most natural Voice available
    const PickVoices = () => {
        const V = Voices.current;
        // FIX 1: added `return` (before, this function always returned undefined)
        return V.find(v => v.lang === 'en-IN' && /natural|online/i.test(v.name)) ||
            V.find(v => v.lang === 'en-IN' && /google/i.test(v.name)) ||
            V.find(v => v.lang === 'en-IN') ||
            V.find(v => /google uk english/i.test(v.name)) ||
            V.find(v => v.lang.startsWith('en'))
    }

    // strip things that sound bad when read aloud

    const cleanText = (t) =>
        t.replace(/https?:\/\/\S+/g, 'link')
            .replace(/[*_`#>~|]/g, '')
            .replace(/\p{Extended_Pictographic}/gu, '')
            .replace(/\s+/g, ' ')
            .trim();


    const Speak = (text) => {
        const synth = window.speechSynthesis;

        synth.cancel() // stop anything already speaking

        clearTimeout(clearTimer.current)

        const id = ++speakId.current; // identifies this call, so stale events from a cancelled call are ignated


        const chunks = cleanText(text).match(/[^.!?।]+[.!?।]*/g) || [];
        const voice = PickVoices();


        chunks.forEach((chunk, i) => {
            const u = new SpeechSynthesisUtterance(chunk.trim());
            if (voice) u.voice = voice;

            u.lang = voice?.lang || 'en-IN';

            u.rate = 1;
            u.pitch = 1.05;
            u.volume = 1;

            u.onstart = () => {
                // FIX 2: compare with speakId.current (not speakId)
                if (id === speakId.current) setSpokenTest(chunk.trim());
            }
            if (i === chunks.length - 1) {
                u.onend = () => {
                    if (id !== speakId.current) return;
                    clearTimer.current = setTimeout(() => setSpokenTest(''), 2500);
                }
            }

            synth.speak(u)
        })
    }


    //Response From the Ai

    const Ai_Response = async (prompt) => {
        try {
            let AI_response_text = await askGemini(prompt)
            console.log(AI_response_text)
            if (AI_response_text) {
                // FIX 3: removed setSpokenTest(response). `response` doesn't exist,
                // and Speak() already sets the caption sentence by sentence.
                Speak(AI_response_text)
            }
        } catch (e) {
            console.log("Error fetching response:", e);
            Speak("Sorry, I encountered an error. Please try again.");
        }
    }

    // FIX 4b: create recognition ONCE. Before, a new one was created on every render,
    // and now that spokenText changes state, that would break start()/stop().
    const recognitionRef = useRef(null);
    if (!recognitionRef.current) {
        let speech_Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
        recognitionRef.current = new speech_Recognition()
        recognitionRef.current.onresult = ((e) => {
            let current_idx = e.resultIndex;
            let transcript = e.results[current_idx][0].transcript
            console.log(transcript)
            console.log(e)

            if(handlecommand(transcript)) return
            Ai_Response(transcript)
        })
    }
    const recognition = recognitionRef.current;

    let Values = {
        recognition,
        Speak,
        spokenText
    }

    return (
        <div>
            <Data_Context.Provider value={Values}>
                {children}
            </Data_Context.Provider>
        </div>
    );
};

export default UserContext;