import * as dotenv from "dotenv";
dotenv.config();

const BASE_URL = process.env.EVAL_URL || "http://localhost:3000";

interface EvalCase {
  id: string;
  description: string;
  question: string;
  must_contain?: string[];
  must_not_contain?: string[];
}

const EVAL_CASES: EvalCase[] = [
  {
    id: "E01",
    description: "Single category spend with refunds",
    question: "How much did I spend on food in March 2025 after refunds?",
    must_contain: ["food", "march", "2025"],
  },
  {
    id: "E02",
    description: "Top merchants",
    question: "What were my top 5 merchants by net spend between January and March 2025?",
    must_contain: ["merchants", "spend"],
  },
  {
    id: "E03",
    description: "Merchant alias grouping",
    question: "How much did I spend on Swiggy in total, including all Swiggy variants?",
    must_contain: ["swiggy"],
  },
  {
    id: "E04",
    description: "Exclude transfers from total",
    question: "Ignore transfers. What was my total actual spending in Q1 2025?",
    must_contain: ["2025"],
  },
  {
    id: "E05",
    description: "Month-over-month comparison",
    question: "Compare my food and travel spending month by month. Which grew faster?",
    must_contain: ["food", "travel"],
  },
  {
    id: "E06",
    description: "Recurring subscriptions detection",
    question: "Which merchants look like recurring subscriptions?",
    must_contain: ["month"],
  },
  {
    id: "E07",
    description: "No data honest response",
    question: "Do I have any transactions for April 2026?",
    must_contain: ["don"],
  },
  {
    id: "E08",
    description: "Category comparison growth",
    question: "Which category had the biggest increase from February to March 2025?",
    must_contain: ["category"],
  },
  {
    id: "E09",
    description: "Fund period return",
    question: "What was the return on Saffron Bluechip Equity Fund from 2024-01-01 to 2025-01-01?",
    must_contain: ["%"],
  },
  {
    id: "E10",
    description: "Rank funds by return",
    question: "Rank all my funds by return between 2024-01-01 and 2025-01-01 and show the spread.",
    must_contain: ["%"],
  },
  {
    id: "E11",
    description: "Portfolio total worth",
    question: "What is my total portfolio worth today, and how much have I made on it?",
    must_contain: ["portfolio", "worth"],
  },
  {
    id: "E12",
    description: "Best performing holding",
    question: "Which of my fund holdings gave me the best realised return?",
    must_contain: ["%"],
  },
  {
    id: "E13",
    description: "Single biggest expense",
    question: "What was my single biggest expense ever?",
    must_contain: ["expense"],
  },
  {
    id: "E14",
    description: "Transfer total",
    question: "How much did I transfer between my own accounts in total?",
    must_contain: ["transfer"],
  },
];

async function ask(question: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const data: any = await res.json();
  return data.answer || data.error || "(no answer)";
}

function check(answer: string, evalCase: EvalCase): { passed: boolean; reason?: string } {
  const lower = answer.toLowerCase();
  for (const term of evalCase.must_contain || []) {
    if (!lower.includes(term.toLowerCase())) {
      return { passed: false, reason: `Missing: "${term}"` };
    }
  }
  for (const term of evalCase.must_not_contain || []) {
    if (lower.includes(term.toLowerCase())) {
      return { passed: false, reason: `Should not contain: "${term}"` };
    }
  }
  return { passed: true };
}

async function main() {
  console.log(`\nRunning evals against ${BASE_URL}\n${"=".repeat(60)}`);
  let passed = 0, failed = 0;
  const failures: any[] = [];

  for (const evalCase of EVAL_CASES) {
    await new Promise(r => setTimeout(r, 12000));
    process.stdout.write(`[${evalCase.id}] ${evalCase.description}... `);
    try {
      const answer = await ask(evalCase.question);
      const { passed: ok, reason } = check(answer, evalCase);
      if (ok) {
        passed++;
        console.log("PASS");
      } else {
        failed++;
        console.log(`FAIL — ${reason}`);
        failures.push({ id: evalCase.id, question: evalCase.question, answer, reason });
      }
    } catch (err: any) {
      failed++;
      console.log(`ERROR — ${err.message}`);
      failures.push({ id: evalCase.id, question: evalCase.question, answer: "", reason: err.message });
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed (${EVAL_CASES.length} total)\n`);

  if (failures.length > 0) {
    console.log("Failed cases:\n");
    for (const f of failures) {
      console.log(`  [${f.id}] ${f.question}`);
      console.log(`         Answer: ${f.answer.slice(0, 150)}`);
      console.log(`         Reason: ${f.reason}\n`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error("Eval crashed:", err); process.exit(1); });