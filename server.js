
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini model
const MODEL = "gemini-3.8-flash";

app.use(express.json({ limit: "1mb" }));

// Homepage: index.html in the main project folder
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Safe diagnostic check: never displays the actual API key
app.get("/health", (req, res) => {
    res.json({
        status: "VIRAT AI server is running!",
        geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY)
    });
});

// Chat API
app.post("/api/chat", async (req, res) => {
    const message = req.body?.message;

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
            error: "Gemini API key is missing. Check Render Environment settings."
        });
    }

    if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({
            error: "Please enter a message."
        });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 80000);

    try {
        const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

        const geminiResponse = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": process.env.GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: message.trim() }]
                    }
                ],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024
                }
            }),
            signal: controller.signal
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();

            let errorMessage = "Gemini API request failed.";

            try {
                const errorData = JSON.parse(errorText);
                errorMessage =
                    errorData.error?.message || errorMessage;
            } catch (e) {
                errorMessage = errorText || errorMessage;
            }

            console.error(
                "Gemini API error:",
                geminiResponse.status,
                errorMessage
            );

            return res.status(502).json({
                error: `Gemini error (${geminiResponse.status}): ${errorMessage}`
            });
        }

        if (!geminiResponse.body) {
            return res.status(502).json({
                error: "Gemini did not return a response stream."
            });
        }

        // Send streamed replies to the website
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const reader = geminiResponse.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (!line.startsWith("data:")) continue;

                const data = line.slice(5).trim();

                if (!data || data === "[DONE]") continue;

                try {
                    const parsed = JSON.parse(data);

                    const parts =
                        parsed.candidates?.[0]?.content?.parts || [];

                    for (const part of parts) {
                        if (typeof part.text === "string") {
                            res.write(
                                `data: ${JSON.stringify({
                                    text: part.text
                                })}\n\n`
                            );
                        }
                    }
                } catch (error) {
                    console.error("Could not parse Gemini stream chunk.");
                }
            }
        }

        res.write("data: [DONE]\n\n");
        res.end();

    } catch (error) {
        console.error("Server error:", error.message);

        if (!res.headersSent) {
            const status = error.name === "AbortError" ? 504 : 500;

            return res.status(status).json({
                error: error.name === "AbortError"
                    ? "Gemini took too long to respond. Please try again."
                    : "Server error: " + error.message
            });
        }

        res.end();

    } finally {
        clearTimeout(timeout);
    }
});

// Start server
app.listen(PORT, () => {
    console.log("VIRAT AI is running!");
    console.log("Port:", PORT);
    console.log(
        "Gemini API key configured:",
        Boolean(process.env.GEMINI_API_KEY)
    );
});
