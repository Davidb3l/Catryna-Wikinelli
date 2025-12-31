
import { GoogleGenAI, Type } from "@google/genai";

export const geminiService = {
  async summarizeCode(code: string): Promise<string> {
    // Initialize GoogleGenAI with the API key from environment variables
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Summarize this code for developer documentation. Keep it concise and technical:\n\n${code}`,
      config: {
        systemInstruction: "You are an expert technical writer for high-performance software engineering teams. Your style is clear, direct, and avoids fluff.",
      },
    });
    return response.text || "Failed to generate summary.";
  },

  async suggestDocumentStructure(topic: string): Promise<string[]> {
    // Initialize GoogleGenAI with the API key from environment variables
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Provide a list of headings for a technical document about: ${topic}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    try {
      return JSON.parse(response.text || '[]');
    } catch (e) {
      return ["Overview", "Installation", "API Usage", "Examples"];
    }
  }
};
