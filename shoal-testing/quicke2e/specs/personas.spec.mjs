// QuickE2E persona flows for the todo app (https://github.com/dmoka/quicke2e).
// Each flow maps one accessibility persona (see ../../personas.yaml) to a
// concrete goal + assertions. QuickE2E's decision model (engine `jev`) drives a
// real browser toward each `goal` within `maxSteps`; code checks the assertions.
//
// This is the FAST BEHAVIOURAL path — "can this persona's task-path be completed,
// and does the result hold?". The accessibility depth (ARIA, labels, screen
// reader) stays with the local subagent reviewers that produced
// ../findings/todo-app-review.md.
//
// Run:  bash ../run.sh         (serves todo/, loads the key, runs these)
// Check (no model calls): npx quicke2e check specs/personas.spec.mjs --base http://127.0.0.1:8777

export default [
  {
    name: "elder-eleanor-add-and-complete",
    start: "/index.html",
    maxSteps: 10,
    goal: "Add a new task called 'Pick up prescriptions', then mark that task as done.",
    done: "The task 'Pick up prescriptions' is in the list and shown as completed.",
    expect: ["Pick up prescriptions"],
  },
  {
    name: "deaf-dana-add-and-see",
    start: "/index.html",
    maxSteps: 8,
    goal: "Add a new task called 'Buy milk' and confirm it appears in the task list.",
    done: "The task 'Buy milk' is visible in the list.",
    expectSeen: ["Buy milk"],
  },
  {
    name: "blind-bruno-add-and-filter",
    start: "/index.html",
    maxSteps: 12,
    goal: "Add a new task called 'Email the team', then use the filters to show only the incomplete tasks.",
    done: "The task 'Email the team' is shown among the incomplete tasks.",
    expect: ["Email the team"],
  },
  {
    name: "child-kai-add-and-tick",
    start: "/index.html",
    maxSteps: 10,
    goal: "Add a task called 'Play outside' and then tick its checkbox to complete it.",
    done: "The task 'Play outside' is completed.",
    expect: ["Play outside"],
  },
  {
    name: "multilingual-mara-add-simple",
    start: "/index.html",
    maxSteps: 8,
    goal: "Add a new task called 'Call doctor'.",
    done: "The task 'Call doctor' is in the list.",
    expectSeen: ["Call doctor"],
  },
];
