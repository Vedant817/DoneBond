"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- API DTOs are runtime-validated at the server boundary; typed client schemas are a follow-up refinement. */

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { decodeFunctionResult, encodeFunctionData, keccak256, parseEther, toHex } from "viem";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? "10143");
const EXPLORER = process.env.NEXT_PUBLIC_MONAD_EXPLORER_URL ?? "https://testnet.monadscan.com";
const CONTRACT = process.env.NEXT_PUBLIC_DONEBOND_CONTRACT_ADDRESS;

interface EthereumProvider {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
}

function provider(): EthereumProvider | null {
  return (globalThis as typeof globalThis & { ethereum?: EthereumProvider }).ethereum ?? null;
}

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function json(response: Response): Promise<any> {
  const body = (await response.json()) as any;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed with HTTP ${response.status}`);
  }
  return body;
}

function csrf(): string | null {
  return sessionStorage.getItem("donebond_csrf");
}

async function api(path: string, init: RequestInit = {}, mutation = false): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (mutation) {
    const token = csrf();
    if (!token) throw new Error("Reconnect your wallet before changing data.");
    headers.set("x-csrf-token", token);
    headers.set("idempotency-key", key("web"));
  }
  return json(await fetch(path, { ...init, headers, cache: "no-store" }));
}

async function connectWallet(): Promise<string> {
  const wallet = provider();
  if (!wallet)
    throw new Error("No injected wallet was found. Install MetaMask or another EIP-1193 wallet.");
  const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("The wallet did not return an account.");
  const chainHex = (await wallet.request({ method: "eth_chainId" })) as string;
  if (Number.parseInt(chainHex, 16) !== CHAIN_ID) {
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }]
      });
    } catch {
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: `0x${CHAIN_ID.toString(16)}`,
            chainName: "Monad Testnet",
            nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
            rpcUrls: [process.env.NEXT_PUBLIC_MONAD_RPC_URL],
            blockExplorerUrls: [EXPLORER]
          }
        ]
      });
    }
  }
  const challengeResponse = await api("/api/v1/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address, chainId: CHAIN_ID })
  });
  const challenge = challengeResponse.challenge;
  const signature = (await wallet.request({
    method: "personal_sign",
    params: [challenge.message, address]
  })) as string;
  const verified = await api("/api/v1/auth/verify", {
    method: "POST",
    body: JSON.stringify({ id: challenge.id, nonce: challenge.nonce, signature })
  });
  sessionStorage.setItem("donebond_csrf", verified.csrfToken);
  return verified.account.address;
}

export function ProductShell({ children }: { readonly children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const result = await api("/api/v1/auth/session");
      setAddress(result.session.address);
    } catch {
      setAddress(null);
    }
  }, []);
  useEffect(() => {
    const timeout = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timeout);
  }, [refresh]);
  return (
    <main className="product-page">
      <nav className="product-nav" aria-label="Primary navigation">
        <Link href="/">DoneBond</Link>
        <div className="product-nav-links">
          <Link href="/projects">Projects</Link>
          {address ? (
            <span
              className="wallet-pill"
              title={address}
            >{`${address.slice(0, 6)}…${address.slice(-4)}`}</span>
          ) : (
            <button
              className="product-button"
              onClick={() =>
                void connectWallet()
                  .then(setAddress)
                  .catch((cause) => setError(String(cause.message ?? cause)))
              }
            >
              Connect wallet
            </button>
          )}
        </div>
      </nav>
      {error ? (
        <div className="product-alert" role="alert">
          {error}
        </div>
      ) : null}
      {!address ? (
        <section className="product-empty">
          <p className="eyebrow">Wallet authentication</p>
          <h1>Connect the wallet that owns your DoneBond projects.</h1>
          <p>
            Authentication signs a short, expiring message. DoneBond never requests a private key.
          </p>
          <button
            className="product-button product-button-primary"
            onClick={() =>
              void connectWallet()
                .then(setAddress)
                .catch((cause) => setError(String(cause.message ?? cause)))
            }
          >
            Connect wallet
          </button>
        </section>
      ) : (
        children
      )}
    </main>
  );
}

export function ProjectsDashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api("/api/v1/projects?limit=100")
      .then((body) => setItems(body.items))
      .catch((cause) => setError(cause.message));
  }, []);
  return (
    <section className="product-section">
      <div className="product-heading-row">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Projects</h1>
        </div>
        <Link className="product-button product-button-primary" href="/projects/new">
          Create project
        </Link>
      </div>
      {error ? <p className="product-alert">{error}</p> : null}
      {items.length === 0 && !error ? (
        <div className="product-empty">
          <h2>Create your first project</h2>
          <p>Bind a GitHub repository to a deterministic verification policy.</p>
        </div>
      ) : null}
      <div className="product-grid">
        {items.map(({ project, role }) => (
          <Link
            className="product-card"
            href={`/projects/${project.publicId}`}
            key={project.publicId}
          >
            <span className="status-line">
              {project.status} · {role}
            </span>
            <h2>{project.name}</h2>
            <p>{project.repositoryUrl}</p>
            <code>{project.activePolicyHash ?? "No active policy"}</code>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function CreateProjectForm() {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const body = await api(
        "/api/v1/projects",
        {
          method: "POST",
          body: JSON.stringify({
            slug: form.get("slug"),
            name: form.get("name"),
            repositoryUrl: form.get("repositoryUrl"),
            defaultBranch: form.get("defaultBranch"),
            visibility: form.get("visibility")
          })
        },
        true
      );
      location.assign(`/projects/${body.project.publicId}`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <section className="product-section narrow">
      <p className="eyebrow">New project</p>
      <h1>Bind a repository</h1>
      <form className="product-form" onSubmit={(event) => void submit(event)}>
        <label>
          Name
          <input name="name" required maxLength={120} />
        </label>
        <label>
          Slug
          <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
        </label>
        <label>
          GitHub repository URL
          <input
            name="repositoryUrl"
            type="url"
            required
            placeholder="https://github.com/owner/repository.git"
          />
        </label>
        <label>
          Default branch
          <input name="defaultBranch" required defaultValue="main" />
        </label>
        <label>
          Visibility
          <select name="visibility" defaultValue="private">
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        {error ? <p className="product-alert">{error}</p> : null}
        <button className="product-button product-button-primary">Create project</button>
      </form>
    </section>
  );
}

const POLICY_TEMPLATE = `schemaVersion: 1
repository:
  requireCleanWorkingTree: true
  allowedBranches: [main]
checks:
  - key: test
    label: Tests
    executable: pnpm
    args: [test]
    cwd: .
    timeoutSeconds: 600
    required: true
    maxOutputBytes: 65536
    environmentAllowlist: [PATH]
environment:
  allow: [PATH]
redaction:
  additionalPatterns: []
`;

export function ProjectDetail({ projectId }: { readonly projectId: string }) {
  const [project, setProject] = useState<any>(null);
  const [policies, setPolicies] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [projectBody, policyBody, taskBody] = await Promise.all([
        api(`/api/v1/projects/${projectId}`),
        api(`/api/v1/projects/${projectId}/policies?limit=100`),
        api(`/api/v1/projects/${projectId}/tasks?limit=100`)
      ]);
      setProject(projectBody.project);
      setPolicies(policyBody.items);
      setTasks(taskBody.items);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    const timeout = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timeout);
  }, [refresh]);
  async function uploadPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(
        `/api/v1/projects/${projectId}/policies`,
        {
          method: "POST",
          body: JSON.stringify({
            sourcePath: ".donebond/policy.yml",
            yaml: form.get("yaml"),
            activate: true
          })
        },
        true
      );
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function createToken() {
    try {
      const body = await api(
        `/api/v1/projects/${projectId}/cli-tokens`,
        { method: "POST", body: JSON.stringify({}) },
        true
      );
      setToken(body.token.plaintext);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  if (!project)
    return (
      <section className="product-section">
        <p>{error ?? "Loading project…"}</p>
      </section>
    );
  return (
    <section className="product-section">
      <p className="eyebrow">Project</p>
      <div className="product-heading-row">
        <div>
          <h1>{project.name}</h1>
          <p>{project.repositoryUrl}</p>
        </div>
        <Link
          className="product-button product-button-primary"
          href={`/projects/${projectId}/tasks/new`}
        >
          Create task
        </Link>
      </div>
      {error ? <p className="product-alert">{error}</p> : null}
      <div className="product-grid">
        <div className="product-card">
          <h2>CLI access</h2>
          <p>Create a project-scoped token. It is shown only once.</p>
          <button className="product-button" onClick={() => void createToken()}>
            Create CLI token
          </button>
          {token ? (
            <>
              <textarea readOnly value={token} aria-label="CLI token" />
              <code>{`printf '%s' '<token>' | donebond init --api-url ${location.origin} --project-id ${projectId} --token-stdin`}</code>
            </>
          ) : null}
        </div>
        <div className="product-card">
          <h2>Active policy</h2>
          <code>{project.activePolicyHash ?? "No active policy"}</code>
          <p>{policies.length} saved version(s)</p>
        </div>
      </div>
      <form className="product-form product-card" onSubmit={(event) => void uploadPolicy(event)}>
        <h2>Upload and activate policy</h2>
        <textarea
          name="yaml"
          required
          defaultValue={POLICY_TEMPLATE}
          rows={18}
          spellCheck={false}
        />
        <button className="product-button">Validate and activate</button>
      </form>
      <h2>Tasks</h2>
      {tasks.length === 0 ? (
        <div className="product-empty">
          <p>No tasks yet.</p>
        </div>
      ) : (
        <div className="product-grid">
          {tasks.map((task) => (
            <Link className="product-card" href={`/tasks/${task.publicId}`} key={task.publicId}>
              <span className="status-line">{task.chainStatus}</span>
              <h3>{task.title}</h3>
              <code>{task.taskHash}</code>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function CreateTaskForm({ projectId }: { readonly projectId: string }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const reward = String(form.get("reward") ?? "0");
      const body = await api(
        `/api/v1/projects/${projectId}/tasks`,
        {
          method: "POST",
          body: JSON.stringify({
            title: form.get("title"),
            description: form.get("description"),
            targetBranch: form.get("targetBranch"),
            baseCommit: null,
            acceptanceCriteria: [{ key: "acceptance", description: form.get("acceptance") }],
            assigneeWallet: form.get("assigneeWallet"),
            deadline: form.get("deadline")
              ? new Date(String(form.get("deadline"))).toISOString().replace(/\.\d{3}Z$/u, ".000Z")
              : null,
            rewardWei: reward === "" ? "0" : parseEther(reward).toString(),
            chainId: CHAIN_ID
          })
        },
        true
      );
      location.assign(`/tasks/${body.task.publicId}`);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  return (
    <section className="product-section narrow">
      <p className="eyebrow">New task</p>
      <h1>Define a verifiable outcome</h1>
      <form className="product-form" onSubmit={(event) => void submit(event)}>
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          Requested outcome
          <textarea name="description" required rows={5} />
        </label>
        <label>
          Acceptance criterion
          <textarea name="acceptance" required rows={3} />
        </label>
        <label>
          Target branch
          <input name="targetBranch" defaultValue="main" required />
        </label>
        <label>
          Assignee wallet
          <input name="assigneeWallet" required pattern="0x[0-9a-fA-F]{40}" />
        </label>
        <label>
          Deadline
          <input name="deadline" type="datetime-local" />
        </label>
        <label>
          Reward in MON
          <input name="reward" inputMode="decimal" defaultValue="0" />
        </label>
        {error ? <p className="product-alert">{error}</p> : null}
        <button className="product-button product-button-primary">Create draft</button>
      </form>
    </section>
  );
}

async function sendIntent(path: string, outcomePath: string): Promise<string> {
  const wallet = provider();
  if (!wallet) throw new Error("No wallet provider found.");
  const intent = await api(path, { method: "POST", body: JSON.stringify({}) }, true);
  if (!intent.walletRequest) return intent.transaction.transactionHash ?? "Already requested";
  const request = intent.walletRequest;
  try {
    const hash = (await wallet.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: request.from,
          to: request.to,
          value: `0x${BigInt(request.value).toString(16)}`,
          data: request.data
        }
      ]
    })) as string;
    let transaction: any = null;
    for (let attempt = 0; attempt < 20 && transaction === null; attempt += 1) {
      transaction = await wallet.request({ method: "eth_getTransactionByHash", params: [hash] });
      if (transaction === null) await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!transaction)
      throw new Error("Wallet broadcast succeeded but transaction metadata is unavailable.");
    await api(
      outcomePath,
      {
        method: "POST",
        body: JSON.stringify({
          transactionId: intent.transaction.publicId,
          status: "submitted",
          transactionHash: hash,
          nonce: BigInt(transaction.nonce).toString()
        })
      },
      true
    );
    const reconcilePath = path.includes("receipt-intent")
      ? `/api/v1/chain/reconcile-receipt/${intent.transaction.publicId}`
      : `/api/v1/chain/reconcile/${intent.transaction.publicId}`;
    try {
      await api(reconcilePath, { method: "POST", body: JSON.stringify({}) }, true);
    } catch {
      // The transaction is durably registered. A transient RPC failure remains retryable.
    }
    return hash;
  } catch (cause: any) {
    if (cause?.code === 4001)
      await api(
        outcomePath,
        {
          method: "POST",
          body: JSON.stringify({
            transactionId: intent.transaction.publicId,
            status: "rejected_by_user",
            transactionHash: null,
            nonce: null
          })
        },
        true
      );
    throw cause;
  }
}

const SETTLEMENT_ABI = [
  {
    type: "function",
    name: "tasks",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "deadline", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "assignee", type: "address" },
      { name: "reward", type: "uint96" },
      { name: "taskHash", type: "bytes32" },
      { name: "policyHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "commitHash", type: "bytes32" }
    ],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "approveTask",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "rejectTask",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "reasonHash", type: "bytes32" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "cancelTask",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: []
  },
  { type: "function", name: "withdraw", inputs: [], outputs: [] }
] as const;

const CHAIN_STATUSES = [
  "none",
  "open",
  "receipt_submitted",
  "approved",
  "rejected",
  "cancelled",
  "expired"
] as const;

async function withCurrentChainStatus(task: any): Promise<any> {
  const wallet = provider();
  if (!wallet || !CONTRACT || task.chainTaskId === null) return task;
  try {
    const data = encodeFunctionData({
      abi: SETTLEMENT_ABI,
      functionName: "tasks",
      args: [BigInt(task.chainTaskId)]
    });
    const result = (await wallet.request({
      method: "eth_call",
      params: [{ to: CONTRACT, data }, "latest"]
    })) as `0x${string}`;
    const decoded = decodeFunctionResult({
      abi: SETTLEMENT_ABI,
      functionName: "tasks",
      data: result
    }) as readonly unknown[];
    const status = CHAIN_STATUSES[Number(decoded[2])];
    return status ? { ...task, chainStatus: status } : task;
  } catch {
    return task;
  }
}

export function TaskDetail({ taskId }: { readonly taskId: string }) {
  const [task, setTask] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const taskBody = await api(`/api/v1/tasks/${taskId}`);
      setTask(await withCurrentChainStatus(taskBody.task));
      try {
        const receiptBody = await api(`/api/v1/tasks/${taskId}/receipt`);
        setReceipt(receiptBody.receipt);
      } catch {
        setReceipt(null);
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [taskId]);
  useEffect(() => {
    const timeout = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timeout);
  }, [refresh]);
  async function action(kind: "create" | "receipt") {
    try {
      const hash =
        kind === "create"
          ? await sendIntent(
              `/api/v1/tasks/${taskId}/chain-intent`,
              `/api/v1/tasks/${taskId}/chain-transactions`
            )
          : await sendIntent(
              `/api/v1/tasks/${taskId}/receipt-intent`,
              `/api/v1/tasks/${taskId}/receipt-transactions`
            );
      setMessage(`Submitted ${hash}`);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function direct(functionName: "approveTask" | "rejectTask" | "cancelTask" | "withdraw") {
    try {
      const wallet = provider();
      if (!wallet || !task) throw new Error("Wallet unavailable");
      if (!CONTRACT) throw new Error("DoneBond contract address is not configured.");
      const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
      const args =
        functionName === "withdraw"
          ? []
          : functionName === "rejectTask"
            ? [
                BigInt(task.chainTaskId),
                keccak256(
                  toHex(
                    globalThis.prompt("Public rejection reason")?.trim() ||
                      "Receipt rejected by creator"
                  )
                )
              ]
            : [BigInt(task.chainTaskId)];
      const data = encodeFunctionData({ abi: SETTLEMENT_ABI, functionName, args } as any);
      const hash = await wallet.request({
        method: "eth_sendTransaction",
        params: [{ from: accounts[0], to: CONTRACT, value: "0x0", data }]
      });
      setMessage(`Submitted ${hash}`);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const mined = (await wallet.request({
          method: "eth_getTransactionReceipt",
          params: [hash]
        })) as { status?: string } | null;
        if (mined?.status === "0x1") {
          const nextStatus =
            functionName === "approveTask"
              ? "approved"
              : functionName === "rejectTask"
                ? "rejected"
                : functionName === "cancelTask"
                  ? "cancelled"
                  : null;
          if (nextStatus) setTask((current: any) => ({ ...current, chainStatus: nextStatus }));
          break;
        }
        if (mined?.status === "0x0") throw new Error("The settlement transaction reverted.");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  if (!task)
    return (
      <section className="product-section">
        <p>{error ?? "Loading task…"}</p>
      </section>
    );
  return (
    <section className="product-section">
      <p className="eyebrow">Task · {task.chainStatus}</p>
      <h1>{task.title}</h1>
      <p className="lead">{task.description}</p>
      {error ? <p className="product-alert">{error}</p> : null}
      {message ? <p className="product-success">{message}</p> : null}
      <div className="product-actions">
        {task.chainStatus === "none" ? (
          <button
            className="product-button product-button-primary"
            onClick={() => void action("create")}
          >
            Fund and create on Monad
          </button>
        ) : null}
        {task.chainStatus === "open" ? (
          <button
            className="product-button product-button-primary"
            onClick={() => void action("receipt")}
          >
            Submit passing receipt
          </button>
        ) : null}
        {task.chainStatus === "receipt_submitted" ? (
          <>
            <button
              className="product-button product-button-primary"
              onClick={() => void direct("approveTask")}
            >
              Approve receipt
            </button>
            <button className="product-button" onClick={() => void direct("rejectTask")}>
              Reject receipt
            </button>
          </>
        ) : null}
        {task.chainStatus === "open" ? (
          <button className="product-button" onClick={() => void direct("cancelTask")}>
            Cancel task
          </button>
        ) : null}
        <button className="product-button" onClick={() => void direct("withdraw")}>
          Withdraw credited MON
        </button>
        {receipt ? (
          <Link className="product-button" href={`/proof/${taskId}`}>
            Open public proof
          </Link>
        ) : null}
      </div>
      <div className="product-card hash-list">
        <h2>Commitments</h2>
        <code>Task {task.taskHash}</code>
        <code>Policy {task.policyHash}</code>
        <code>Assignee {task.assigneeWallet}</code>
        <code>Reward {task.rewardWei} wei</code>
        {task.chainTaskId ? <code>Onchain task #{task.chainTaskId}</code> : null}
      </div>
      {receipt ? (
        <div className="product-card">
          <h2>Receipt</h2>
          <p>Integrity: {receipt.integrityStatus}</p>
          <code>{receipt.evidenceHash}</code>
          <a href={receipt.explorerTransactionUrl} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>
        </div>
      ) : (
        <div className="product-empty">
          <p>No confirmed receipt yet. Failed evidence cannot create a receipt intent.</p>
        </div>
      )}
    </section>
  );
}

export function PublicProof({ receiptId }: { readonly receiptId: string }) {
  const [receipt, setReceipt] = useState<any>(null);
  const [evidence, setEvidence] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api(`/api/v1/receipt/${receiptId}`)
      .then(async (body) => {
        setReceipt(body.receipt);
        const detail = await api(`/api/v1/evidence/${body.receipt.evidenceBundlePublicId}`);
        setEvidence(detail.evidence);
      })
      .catch((cause) => setError(cause.message));
  }, [receiptId]);
  return (
    <main className="product-page">
      <nav className="product-nav">
        <Link href="/">DoneBond</Link>
        <span className="status-line">Public proof</span>
      </nav>
      <section className="product-section narrow">
        {error ? (
          <div className="product-empty">
            <h1>Proof unavailable</h1>
            <p>{error}</p>
          </div>
        ) : !receipt ? (
          <p>Loading independent proof data…</p>
        ) : (
          <>
            <p className="eyebrow">
              {receipt.integrityStatus === "verified" ? "Verified integrity" : "Integrity warning"}
            </p>
            <h1>{receipt.title}</h1>
            <p>
              This proves that the exact evidence and Git commit below were attested and anchored on
              Monad. It does not mean the blockchain executed the checks.
            </p>
            <div className="product-card hash-list">
              <code>Task {receipt.taskHash}</code>
              <code>Policy {receipt.policyHash}</code>
              <code>Evidence {receipt.evidenceHash}</code>
              <code>Commit {receipt.commitHash}</code>
              <code>Transaction {receipt.submissionTransactionHash}</code>
            </div>
            <h2>Deterministic checks</h2>
            <div className="product-grid">
              {receipt.checks.map((check: any) => (
                <div className="product-card" key={check.key}>
                  <span className="status-line">{check.status}</span>
                  <h3>{check.label}</h3>
                  <p>
                    {check.durationMs} ms · exit {check.exitCode ?? "—"}
                  </p>
                </div>
              ))}
            </div>
            <div className="product-actions">
              <a
                className="product-button product-button-primary"
                href={receipt.explorerTransactionUrl}
                target="_blank"
                rel="noreferrer"
              >
                View on Monad explorer ↗
              </a>
              {evidence ? (
                <a
                  className="product-button"
                  href={`/api/v1/evidence/${receipt.evidenceBundlePublicId}`}
                  download
                >
                  Download safe evidence JSON
                </a>
              ) : null}
            </div>
            <p className="proof-caveat">
              Independent verification: run{" "}
              <code>
                donebond receipt verify {receiptId} --api-url {location.origin} --rpc-url
                &lt;your-rpc&gt;
              </code>
              .
            </p>
          </>
        )}
      </section>
    </main>
  );
}
