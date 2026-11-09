
require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = "gemini-3.5-flash-lite";

app.use(express.json());

// Serve the homepage from the main project folder.
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Serve any additional frontend files from public.
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
    res.json({ status: "VIRAT AI server is running!" });
});

app.post("/api/chat", async (req, res) => {
    const message = req.body.message;

    if (!message || typeof message !== "string") {
        return res.status(400).json({
            error: "Please enter a message."
        });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "Gemini API key is missing."
        });
    }

    console.log("New message received:", message);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    function sendEvent(data) {
        if (!res.destroyed && !res.writableEnded) {
            res.write("data: " + JSON.stringify(data) + "\n\n");
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        console.log("Connecting to Gemini using", MODEL);

        const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: message }]
                }]
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            let details = {};

            try {
                details = JSON.parse(errorText);
            } catch (e) {}

            console.error("Gemini API status:", response.status);
            console.error("Gemini API error:", details);

            if (response.status === 429) {
                throw new Error("Gemini quota reached. Please try again later.");
            }

            if (response.status === 503) {
                throw new Error("Gemini is busy. Please try again shortly.");
            }

            throw new Error(
                details.error?.message || "Gemini API request failed."
            );
        }

        if (!response.body) {
            throw new Error("Gemini returned no response stream.");
        }

        console.log("Gemini stream started!");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";
        let receivedText = false;

        function processEvent(event) {
            const data = event
                .split("\n")
                .filter(line => line.startsWith("data:"))
                .map(line => line.slice(5).trim())
                .join("\n");

            if (!data || data === "[DONE]") return;

            const result = JSON.parse(data);

            if (result.error) {
                throw new Error(
                    result.error.message || "Gemini returned an error."
                );
            }

            const parts =
                result.candidates?.[0]?.content?.parts || [];

            for (const part of parts) {
                if (part.text) {
                    receivedText = true;
                    sendEvent({ text: part.text });
                }
            }
        }

        while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            buffer = buffer.replace(/\r\n/g, "\n");

            const events = buffer.split("\n\n");
            buffer = events.pop();

            for (const event of events) {
                processEvent(event);
            }
        }

        buffer += decoder.decode();
        buffer = buffer.replace(/\r\n/g, "\n");

        if (buffer.trim()) {
            processEvent(buffer);
        }

        if (!receivedText) {
            throw new Error("Gemini returned an empty reply.");
        }

        sendEvent({ done: true });
        console.log("Gemini finished replying!");

    } catch (error) {
        console.error("GEMINI ERROR:", error);

        let message = error.message ||
            "VIRAT AI could not connect to Gemini.";

        if (error.name === "AbortError") {
            message = "Gemini took too long to respond. Please try again.";
        }

        sendEvent({ error: message });

    } finally {
        clearTimeout(timeout);

        if (!res.destroyed && !res.writableEnded) {
            res.end();
        }
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("VIRAT AI is running!");
    console.log("Port:", PORT);
});
