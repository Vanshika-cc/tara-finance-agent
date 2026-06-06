import express from "express";
import cors from "cors";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { taraAgent } from "./agent";
import { setupSchema } from "./db";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;


interface TraceEntry {
  request_id: string;
  question: string;
  tools_called: string[];
  latency_ms: number;
  status: "success" | "error";
  error?: string;
  timestamp: string;
}
const traces: TraceEntry[] = [];

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tara-agent" });
});

app.get("/traces", (_req, res) => {
  res.json(traces.slice(-50)); // last 50
});

//Main endpoint
app.post("/ask", async (req, res) => {
  const request_id = crypto.randomUUID();
  const startTime = Date.now();
  const { question } = req.body;

  // Input validation
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    return res.status(400).json({ error: "question is required and must be a non-empty string" });
  }

  const toolsCalled: string[] = [];

  console.log(`\n[${request_id}]  Question: ${question}`);

  try {
    const result = await taraAgent.generate(question.trim(), {
      onStepFinish: (step: any) => {
        // Track tool calls for observability
        if (step.toolCalls) {
          for (const call of step.toolCalls) {
            toolsCalled.push(call.toolName);
            console.log(`[${request_id}] 🔧 Tool called: ${call.toolName}`, JSON.stringify(call.args).slice(0, 200));
          }
        }
      },
    });

    const latency_ms = Date.now() - startTime;
    const answer = result.text;

    console.log(`[${request_id}] Answer (${latency_ms}ms): ${answer.slice(0, 200)}`);

    traces.push({
      request_id,
      question,
      tools_called: toolsCalled,
      latency_ms,
      status: "success",
      timestamp: new Date().toISOString(),
    });

    return res.json({ answer });
  } catch (err: any) {
    const latency_ms = Date.now() - startTime;
    console.error(`[${request_id}] Error:`, err.message);

    traces.push({
      request_id,
      question,
      tools_called: toolsCalled,
      latency_ms,
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    });

    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});


async function main() {
  try {
    await setupSchema();
    app.listen(PORT, () => {
      console.log(`\n Tara agent running on http://localhost:${PORT}`);
      console.log(`   POST http://localhost:${PORT}/ask`);
      console.log(`   GET  http://localhost:${PORT}/health`);
      console.log(`   GET  http://localhost:${PORT}/traces\n`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();
