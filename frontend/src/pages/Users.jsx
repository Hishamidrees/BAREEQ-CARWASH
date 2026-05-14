import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../lib/api.js";

const USER_SECTIONS = [
  { key: "home", label: "Home" },
  { key: "add-users", label: "Add Users" },
  { key: "block-users", label: "Block Users" },
  { key: "add-balance", label: "Add Balance" }
];

function formatNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString("en-US") : String(value ?? 0);
}

function moneyCell(value) {
  return (
    <span className="moneyCell">
      <span>{formatNumber(value)}</span>
      <img src="/sar.svg" alt="SAR" className="moneyIcon" onError={(e) => { e.currentTarget.style.display = "none"; }} />
    </span>
  );
}

function normalizeRows(data) {
  return Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
}

function normalizeUid(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getStatus(item) {
  const blocked = !!(item.blocked ?? item.is_blocked ?? item.status === "blocked");
  return blocked ? "Blocked" : "Active";
}

function composePlate(digits, letters) {
  return `${String(digits || "")}${String(letters || "").toUpperCase()}`;
}

function rowMatches(row, searchBy, query, digits, letters) {
  if (!query && !digits && !letters) return true;
  const q = String(query || "").trim().toLowerCase();
  const uidQuery = normalizeUid(query);
  const plateDigits = String(digits || "").trim();
  const plateLetters = String(letters || "").trim().toUpperCase();

  if (searchBy === "uid") return normalizeUid(row.uid).includes(uidQuery);
  if (searchBy === "name") return String(row.name || "").toLowerCase().includes(q);
  if (searchBy === "carplate") {
    const d = String(row.plate_digits || "");
    const l = String(row.plate_letters || row.plate_letter || "").toUpperCase();
    return (!plateDigits || d.includes(plateDigits)) && (!plateLetters || l.includes(plateLetters));
  }

  const hay = [row.name, row.uid, row.plate_digits, row.plate_letters, row.plate_letter, row.balance, row.visits_count].join(" ").toLowerCase();
  return hay.includes(q);
}

function SegmentedInput({ value, onChange, slotCount, charsPerSlot, sanitize, placeholders, inputMode = "text", refs, autoAdvanceTargetRef }) {
  const normalized = useMemo(() => sanitize(String(value || "")), [value, sanitize]);
  const slots = useMemo(() => {
    const out = [];
    for (let i = 0; i < slotCount; i += 1) out.push(normalized.slice(i * charsPerSlot, (i + 1) * charsPerSlot));
    return out;
  }, [normalized, slotCount, charsPerSlot]);

  function setSlot(index, rawValue) {
    const cleaned = sanitize(rawValue).slice(0, charsPerSlot);
    const next = [...slots];
    next[index] = cleaned;
    onChange(next.join(""));
    if (cleaned.length >= charsPerSlot) {
      if (index < slotCount - 1) {
        refs?.current?.[index + 1]?.focus();
        refs?.current?.[index + 1]?.select?.();
      } else if (autoAdvanceTargetRef?.current?.[0]) {
        autoAdvanceTargetRef.current[0].focus();
        autoAdvanceTargetRef.current[0].select?.();
      }
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {slots.map((slotValue, index) => (
        <input
          key={index}
          ref={(el) => { if (refs?.current) refs.current[index] = el; }}
          value={slotValue}
          inputMode={inputMode}
          placeholder={placeholders?.[index] || ""}
          onChange={(e) => setSlot(index, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !slotValue && index > 0) {
              refs?.current?.[index - 1]?.focus();
              refs?.current?.[index - 1]?.select?.();
            }
          }}
          style={{ width: charsPerSlot === 1 ? 44 : 58, textAlign: "center", fontWeight: 900 }}
        />
      ))}
    </div>
  );
}

function PlateDigits({ value, onChange, length = 4, refs, nextRefs }) {
  return <SegmentedInput value={value} onChange={onChange} slotCount={length} charsPerSlot={1} sanitize={(v) => String(v || "").replace(/\D/g, "")} placeholders={Array.from({ length }, () => "0")} inputMode="numeric" refs={refs} autoAdvanceTargetRef={nextRefs} />;
}

function PlateLetters({ value, onChange, length = 3, refs }) {
  return <SegmentedInput value={value} onChange={onChange} slotCount={length} charsPerSlot={1} sanitize={(v) => String(v || "").toUpperCase().replace(/[^A-Z]/g, "")} placeholders={Array.from({ length }, () => "A")} inputMode="text" refs={refs} />;
}

function UidInput({ value, onChange }) {
  const uidRefs = useRef([]);
  return <SegmentedInput value={value} onChange={onChange} slotCount={4} charsPerSlot={2} sanitize={(v) => normalizeUid(v)} placeholders={["AA", "BB", "CC", "DD"]} inputMode="text" refs={uidRefs} />;
}

function SearchPlateInputs({ digits, setDigits, letters, setLetters }) {
  const digitRefs = useRef([]);
  const letterRefs = useRef([]);
  return (
    <div className="row">
      <div><div className="small">Digits</div><PlateDigits value={digits} onChange={setDigits} refs={digitRefs} nextRefs={letterRefs} /></div>
      <div><div className="small">Letters</div><PlateLetters value={letters} onChange={setLetters} refs={letterRefs} /></div>
    </div>
  );
}

function PlateSearchMatches({ items, onPick }) {
  if (!items.length) return null;
  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="small" style={{ marginBottom: 8 }}>Match Car Plates</div>
      <div className="matchHints">
        {items.map((item, index) => {
          const label = `${item.plate_digits || ""}-${item.plate_letters || item.plate_letter || ""}`;
          return <button key={`${label}-${index}`} type="button" onClick={() => onPick(item)} style={{ padding: "8px 10px" }}>{label}</button>;
        })}
      </div>
    </div>
  );
}

function UsersSidebar({ section, setSection }) {
  return (
    <div className="sideNav">
      <div className="sideNavTitle">Users</div>
      <div className="sideNavGroup">
        {USER_SECTIONS.map((item) => (
          <button key={item.key} type="button" className={`sideNavBtn ${section === item.key ? "active" : ""}`} onClick={() => setSection(item.key)}>{item.label}</button>
        ))}
      </div>
    </div>
  );
}

function UsersTable({ rows, onDelete, deletingUid }) {
  return (
    <div className="tableWrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Plate Digits</th>
            <th>Plate Letter</th>
            <th>UID</th>
            <th>Balance (SAR)</th>
            <th>Visits#</th>
            <th>Status</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, idx) => {
            const uid = item.uid || item.id || "";
            const status = getStatus(item);
            return (
              <tr key={uid || idx}>
                <td>{item.name || "--"}</td>
                <td>{item.plate_digits || "--"}</td>
                <td>{item.plate_letters || item.plate_letter || "--"}</td>
                <td>{uid || "--"}</td>
                <td>{moneyCell(item.balance || 0)}</td>
                <td>{formatNumber(item.visits_count || 0)}</td>
                <td><span className={`badge ${status === "Blocked" ? "blocked" : "ok"}`}>{status}</span></td>
                <td><button className="dangerBtn" disabled={!uid || deletingUid === uid} onClick={() => onDelete(uid)}>{deletingUid === uid ? "Deleting..." : "Delete"}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UserPreviewCard({ user }) {
  if (!user) return <div className="emptyState">No user found.</div>;
  return (
    <div className="panel">
      <div style={{ fontSize: 18, fontWeight: 900 }}>{user.name || "--"}</div>
      <div className="kvgrid" style={{ marginTop: 12 }}>
        <div className="kv"><div className="k">UID</div><div className="v" style={{ fontSize: 18 }}>{user.uid || "--"}</div></div>
        <div className="kv"><div className="k">Balance</div><div className="v" style={{ fontSize: 18 }}>{formatNumber(user.balance || 0)}</div></div>
        <div className="kv"><div className="k">Visits</div><div className="v" style={{ fontSize: 18 }}>{formatNumber(user.visits_count || 0)}</div></div>
        <div className="kv"><div className="k">Plate digits</div><div className="v" style={{ fontSize: 18 }}>{user.plate_digits || "--"}</div></div>
        <div className="kv"><div className="k">Plate letters</div><div className="v" style={{ fontSize: 18 }}>{user.plate_letters || user.plate_letter || "--"}</div></div>
        <div className="kv"><div className="k">Status</div><div className="v" style={{ fontSize: 18 }}>{getStatus(user)}</div></div>
      </div>
    </div>
  );
}

function UidSuggestions({ items, onPick }) {
  if (!items.length) return null;
  return (
    <div className="panel" style={{ marginTop: 10 }}>
      <div className="small" style={{ marginBottom: 8 }}>Match UIDs</div>
      <div className="matchHints">
        {items.map((uid) => <button key={uid} type="button" onClick={() => onPick(uid)} style={{ padding: "8px 10px" }}>{uid}</button>)}
      </div>
    </div>
  );
}

function HomeView({ searchBy, setSearchBy, query, setQuery, plateDigits, setPlateDigits, plateLetters, setPlateLetters, rows, loading, msg, msgType, onDelete, deletingUid, resetSearch }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>Home</div>
      <div className="small" style={{ marginTop: 6 }}>Search users, or view all database rows when nothing is searched.</div>
      <div className="hr" />
      <div className="row">
        <div>
          <div className="small">Search by</div>
          <select value={searchBy} onChange={(e) => setSearchBy(e.target.value)}>
            <option value="any">Any</option>
            <option value="uid">UID</option>
            <option value="name">Name</option>
            <option value="carplate">Car Plate</option>
          </select>
        </div>
        {searchBy === "carplate" ? (
          <div>
            <div className="small">Search</div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div className="panel" style={{ flex: 1 }}>
                <div className="small" style={{ marginBottom: 8 }}>Car plate search</div>
                <SearchPlateInputs digits={plateDigits} setDigits={setPlateDigits} letters={plateLetters} setLetters={setPlateLetters} />
              </div>
              <button className="resetBtn" onClick={resetSearch} title="Reset search" aria-label="Reset search">R</button>
            </div>
          </div>
        ) : searchBy === "uid" ? (
          <div>
            <div className="small">Search</div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div className="panel" style={{ flex: 1 }}><div className="small" style={{ marginBottom: 8 }}>UID search</div><UidInput value={query} onChange={setQuery} /></div>
              <button className="resetBtn" onClick={resetSearch} title="Reset search" aria-label="Reset search">R</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="small">Search</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={query} placeholder="Start typing..." onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
              <button className="resetBtn" onClick={resetSearch} title="Reset search" aria-label="Reset search">R</button>
            </div>
          </div>
        )}
      </div>
      {msg ? <div className={`alertBox ${msgType}`}>{msg}</div> : null}
      {loading ? <div className="small" style={{ marginTop: 12 }}>Loading…</div> : null}
      <div className="hr" />
      {rows.length ? <UsersTable rows={rows} onDelete={onDelete} deletingUid={deletingUid} /> : <div className="emptyState">No users found.</div>}
    </div>
  );
}

function AddUsersView({ newUid, setNewUid, newName, setNewName, newBal, setNewBal, plateDigits, setPlateDigits, plateLetters, setPlateLetters, addUser, successInfo, clearSuccess, openAddedUser, addDisabled, addValidationMessage }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>Add Users</div>
      <div className="hr" />
      <div className="formSection">
        <div><div className="small">UID</div><UidInput value={newUid} onChange={setNewUid} /></div>
        <div><div className="small">Full name</div><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" /></div>
        <div><div className="small">Initial balance</div><input type="number" value={newBal} onChange={(e) => setNewBal(e.target.value)} /></div>
        <div className="panel"><div style={{ fontWeight: 900, marginBottom: 6 }}>Plate number</div><SearchPlateInputs digits={plateDigits} setDigits={setPlateDigits} letters={plateLetters} setLetters={setPlateLetters} /></div>
        <button onClick={addUser} disabled={addDisabled}>Add user</button>
        {addValidationMessage ? <div className="small">{addValidationMessage}</div> : null}
      </div>
      {successInfo ? (
        <div className="alertBox success">
          <div><strong>User added successfully.</strong></div>
          <div className="small" style={{ marginTop: 6 }}>UID: {successInfo.uid} {successInfo.name ? `• ${successInfo.name}` : ""}</div>
          <div className="alertActions"><button onClick={openAddedUser}>View in Home</button><button onClick={clearSuccess}>Close</button></div>
        </div>
      ) : null}
    </div>
  );
}

function BlockUsersView({ blockBy, setBlockBy, blockQuery, setBlockQuery, blockDigits, setBlockDigits, blockLetters, setBlockLetters, previewUser, previewLoading, blockUser, unblockUser, msg, msgType, uidSuggestions, plateSuggestions, onPickPlate }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>Block Users</div>
      <div className="small" style={{ marginTop: 6 }}>Search by UID or car plate, then block or unblock.</div>
      <div className="hr" />
      <div className="row">
        <div><div className="small">Search by</div><select value={blockBy} onChange={(e) => setBlockBy(e.target.value)}><option value="uid">UID</option><option value="carplate">Car Plate</option></select></div>
        {blockBy === "carplate" ? (
          <div className="panel"><div className="small" style={{ marginBottom: 8 }}>Car plate</div><SearchPlateInputs digits={blockDigits} setDigits={setBlockDigits} letters={blockLetters} setLetters={setBlockLetters} /><PlateSearchMatches items={plateSuggestions} onPick={onPickPlate} /></div>
        ) : (
          <div><div className="small">UID</div><UidInput value={blockQuery} onChange={setBlockQuery} /><UidSuggestions items={uidSuggestions} onPick={setBlockQuery} /></div>
        )}
      </div>
      <div className="hr" />
      {previewLoading ? <div className="small">Loading user...</div> : <UserPreviewCard user={previewUser} />}
      <div className="row" style={{ marginTop: 12 }}><button onClick={blockUser} disabled={!previewUser}>Block user</button><button onClick={unblockUser} disabled={!previewUser}>Unblock user</button></div>
      {msg ? <div className={`alertBox ${msgType}`}>{msg}</div> : null}
    </div>
  );
}

function AddBalanceView({ balanceBy, setBalanceBy, balanceQuery, setBalanceQuery, balanceDigits, setBalanceDigits, balanceLetters, setBalanceLetters, previewUser, previewLoading, amount, setAmount, addBalance, msg, msgType, uidSuggestions, plateSuggestions, onPickPlate }) {
  return (
    <div className="card">
      <div style={{ fontSize: 22, fontWeight: 900 }}>Add Balance</div>
      <div className="small" style={{ marginTop: 6 }}>Search by UID or car plate, preview the user, then add balance.</div>
      <div className="hr" />
      <div className="row">
        <div><div className="small">Search by</div><select value={balanceBy} onChange={(e) => setBalanceBy(e.target.value)}><option value="uid">UID</option><option value="carplate">Car Plate</option></select></div>
        {balanceBy === "carplate" ? (
          <div className="panel"><div className="small" style={{ marginBottom: 8 }}>Car plate</div><SearchPlateInputs digits={balanceDigits} setDigits={setBalanceDigits} letters={balanceLetters} setLetters={setBalanceLetters} /><PlateSearchMatches items={plateSuggestions} onPick={onPickPlate} /></div>
        ) : (
          <div><div className="small">UID</div><UidInput value={balanceQuery} onChange={setBalanceQuery} /><UidSuggestions items={uidSuggestions} onPick={setBalanceQuery} /></div>
        )}
      </div>
      <div className="hr" />
      {previewLoading ? <div className="small">Loading user...</div> : <UserPreviewCard user={previewUser} />}
      <div className="row" style={{ marginTop: 12 }}>
        <div><div className="small">Amount</div><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" /></div>
        <div style={{ display: "flex", alignItems: "end" }}><button style={{ width: "100%" }} onClick={addBalance} disabled={!previewUser || !String(amount).trim()}>Add balance</button></div>
      </div>
      {msg ? <div className={`alertBox ${msgType}`}>{msg}</div> : null}
    </div>
  );
}

export default function Users() {
  const [section, setSection] = useState("home");
  const [searchBy, setSearchBy] = useState("any");
  const [query, setQuery] = useState("");
  const [plateDigits, setPlateDigits] = useState("");
  const [plateLetters, setPlateLetters] = useState("");
  const [allRows, setAllRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");
  const [newUid, setNewUid] = useState("");
  const [newName, setNewName] = useState("");
  const [newBal, setNewBal] = useState("");
  const [newPlateDigits, setNewPlateDigits] = useState("");
  const [newPlateLetters, setNewPlateLetters] = useState("");
  const [successInfo, setSuccessInfo] = useState(null);
  const [blockBy, setBlockBy] = useState("uid");
  const [blockQuery, setBlockQuery] = useState("");
  const [blockDigits, setBlockDigits] = useState("");
  const [blockLetters, setBlockLetters] = useState("");
  const [blockPreview, setBlockPreview] = useState(null);
  const [blockPreviewLoading, setBlockPreviewLoading] = useState(false);
  const [balanceBy, setBalanceBy] = useState("uid");
  const [balanceQuery, setBalanceQuery] = useState("");
  const [balanceDigits, setBalanceDigits] = useState("");
  const [balanceLetters, setBalanceLetters] = useState("");
  const [balancePreview, setBalancePreview] = useState(null);
  const [balancePreviewLoading, setBalancePreviewLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [deletingUid, setDeletingUid] = useState("");

  const addFormComplete = normalizeUid(newUid).length === 8 && String(newName || "").trim().length > 0 && String(newBal || "").trim().length > 0 && String(newPlateDigits || "").length === 4 && String(newPlateLetters || "").length === 3;
  const addValidationMessage = addFormComplete ? "" : "All fields are required: UID, full name, initial balance, plate digits, and plate letters.";

  const blockUidSuggestions = useMemo(() => {
    if (blockBy !== "uid") return [];
    const prefix = normalizeUid(blockQuery);
    if (!prefix) return [];
    const unique = [...new Set(allRows.map((row) => normalizeUid(row.uid)).filter(Boolean))];
    return unique.filter((uid) => uid.startsWith(prefix)).slice(0, 12);
  }, [allRows, blockBy, blockQuery]);

  const balanceUidSuggestions = useMemo(() => {
    if (balanceBy !== "uid") return [];
    const prefix = normalizeUid(balanceQuery);
    if (!prefix) return [];
    const unique = [...new Set(allRows.map((row) => normalizeUid(row.uid)).filter(Boolean))];
    return unique.filter((uid) => uid.startsWith(prefix)).slice(0, 12);
  }, [allRows, balanceBy, balanceQuery]);

  const blockPlateSuggestions = useMemo(() => {
    if (blockBy !== "carplate") return [];
    const d = String(blockDigits || "");
    const l = String(blockLetters || "").toUpperCase();
    if (!d && !l) return [];
    return allRows.filter((row) => {
      const rd = String(row.plate_digits || "");
      const rl = String(row.plate_letters || row.plate_letter || "").toUpperCase();
      return (!d || rd.startsWith(d)) && (!l || rl.startsWith(l));
    }).slice(0, 12);
  }, [allRows, blockBy, blockDigits, blockLetters]);

  const balancePlateSuggestions = useMemo(() => {
    if (balanceBy !== "carplate") return [];
    const d = String(balanceDigits || "");
    const l = String(balanceLetters || "").toUpperCase();
    if (!d && !l) return [];
    return allRows.filter((row) => {
      const rd = String(row.plate_digits || "");
      const rl = String(row.plate_letters || row.plate_letter || "").toUpperCase();
      return (!d || rd.startsWith(d)) && (!l || rl.startsWith(l));
    }).slice(0, 12);
  }, [allRows, balanceBy, balanceDigits, balanceLetters]);

  function clearAlerts() { setMsg(""); setSuccessInfo(null); }
  function setMessage(text, type = "success") { setMsg(text); setMsgType(type); }

  async function fetchVisitsSummary() {
    try {
      const data = await apiGet('/api/users/visits-summary');
      return data?.items || [];
    } catch {
      return [];
    }
  }

  async function fetchAllUsers() {
    const [data, visits] = await Promise.all([
      apiGet("/api/users/search?by=any&q="),
      fetchVisitsSummary()
    ]);
    const visitMap = Object.fromEntries((visits || []).map((item) => [normalizeUid(item.uid), Number(item.visits_count || 0)]));
    return normalizeRows(data).map((row) => ({ ...row, visits_count: visitMap[normalizeUid(row.uid)] || 0 }));
  }

  async function refreshHomeRows() {
    setLoading(true);
    try {
      const items = await fetchAllUsers();
      setAllRows(items);
      setRows(items.filter((row) => rowMatches(row, searchBy, query, plateDigits, plateLetters)));
    } catch (e) {
      setAllRows([]);
      setRows([]);
      setMessage(String(e?.message || e), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshHomeRows(); }, []);
  useEffect(() => { setRows(allRows.filter((row) => rowMatches(row, searchBy, query, plateDigits, plateLetters))); }, [searchBy, query, plateDigits, plateLetters, allRows]);
  useEffect(() => { clearAlerts(); }, [section]);

  async function fetchSingleUser({ by, uid, digits, letters }) {
    const all = await fetchAllUsers();
    if (by === "uid") {
      const normalizedInput = normalizeUid(uid);
      return all.find((row) => normalizeUid(row.uid) === normalizedInput) || null;
    }
    if (by === "carplate") {
      const d = String(digits || "");
      const l = String(letters || "").toUpperCase();
      return all.find((row) => String(row.plate_digits || "") === d && String(row.plate_letters || row.plate_letter || "").toUpperCase() === l) || null;
    }
    return null;
  }

  function resetSearch() { setSearchBy("any"); setQuery(""); setPlateDigits(""); setPlateLetters(""); }
  function pickBlockPlate(item) { setBlockDigits(String(item.plate_digits || "")); setBlockLetters(String(item.plate_letters || item.plate_letter || "").toUpperCase()); }
  function pickBalancePlate(item) { setBalanceDigits(String(item.plate_digits || "")); setBalanceLetters(String(item.plate_letters || item.plate_letter || "").toUpperCase()); }

  useEffect(() => {
    const timer = setTimeout(async () => {
      const hasInput = blockBy === "uid" ? !!normalizeUid(blockQuery) : !!composePlate(blockDigits, blockLetters);
      if (!hasInput) { setBlockPreview(null); return; }
      setBlockPreviewLoading(true);
      try { setBlockPreview(await fetchSingleUser({ by: blockBy, uid: blockQuery, digits: blockDigits, letters: blockLetters })); }
      catch { setBlockPreview(null); }
      finally { setBlockPreviewLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [blockBy, blockQuery, blockDigits, blockLetters]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const hasInput = balanceBy === "uid" ? !!normalizeUid(balanceQuery) : !!composePlate(balanceDigits, balanceLetters);
      if (!hasInput) { setBalancePreview(null); return; }
      setBalancePreviewLoading(true);
      try { setBalancePreview(await fetchSingleUser({ by: balanceBy, uid: balanceQuery, digits: balanceDigits, letters: balanceLetters })); }
      catch { setBalancePreview(null); }
      finally { setBalancePreviewLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [balanceBy, balanceQuery, balanceDigits, balanceLetters]);

  async function addUser() {
    if (!addFormComplete) { setMessage("All fields are required.", "error"); return; }
    try {
      const payload = { uid: normalizeUid(newUid), name: newName.trim(), balance: Number(newBal), plate_digits: newPlateDigits, plate_letters: newPlateLetters };
      await apiPost("/api/users", payload);
      const items = await fetchAllUsers();
      setAllRows(items);
      const added = items.find((row) => normalizeUid(row.uid) === payload.uid) || { ...payload, visits_count: 0 };
      setSuccessInfo(added);
      setMessage("User added successfully.", "success");
      setNewUid(""); setNewName(""); setNewBal(""); setNewPlateDigits(""); setNewPlateLetters("");
    } catch (e) { setSuccessInfo(null); setMessage(String(e?.message || e), "error"); }
  }

  function openAddedUser() { if (!successInfo) return; setSection("home"); setSearchBy("uid"); setQuery(normalizeUid(successInfo.uid || "")); setPlateDigits(""); setPlateLetters(""); }
  function clearSuccess() { setSuccessInfo(null); }

  async function setBlocked(blocked) {
    if (!blockPreview) { setMessage("User not found.", "error"); return; }
    try {
      const payload = blockBy === "carplate" ? { by: "carplate", plate_digits: blockDigits, plate_letters: blockLetters, blocked } : { by: "uid", q: normalizeUid(blockQuery), blocked };
      await apiPost("/api/users/block", payload);
      await refreshHomeRows();
      const refreshed = await fetchSingleUser({ by: blockBy, uid: blockQuery, digits: blockDigits, letters: blockLetters });
      setBlockPreview(refreshed);
      setMessage(blocked ? "User blocked successfully." : "User unblocked successfully.", "success");
    } catch (e) { setMessage(String(e?.message || e), "error"); }
  }

  async function addBalance() {
    if (!balancePreview) { setMessage("User not found.", "error"); return; }
    try {
      const payload = balanceBy === "carplate" ? { by: "carplate", plate_digits: balanceDigits, plate_letters: balanceLetters, amount: Number(amount || 0) } : { by: "uid", q: normalizeUid(balanceQuery), amount: Number(amount || 0) };
      await apiPost("/api/users/add-balance", payload);
      await refreshHomeRows();
      const refreshed = await fetchSingleUser({ by: balanceBy, uid: balanceQuery, digits: balanceDigits, letters: balanceLetters });
      setBalancePreview(refreshed);
      setMessage("Balance updated successfully.", "success");
      setAmount("");
    } catch (e) { setMessage(String(e?.message || e), "error"); }
  }

  async function deleteUser(uid) {
    if (!uid) return;
    if (!window.confirm(`Delete user ${uid}?`)) return;
    setDeletingUid(uid);
    try { await apiPost("/api/users/delete", { uid: normalizeUid(uid) }); await refreshHomeRows(); setMessage("User deleted successfully.", "success"); }
    catch (e) { setMessage(String(e?.message || e), "error"); }
    finally { setDeletingUid(""); }
  }

  let content = null;
  if (section === "home") content = <HomeView searchBy={searchBy} setSearchBy={setSearchBy} query={query} setQuery={setQuery} plateDigits={plateDigits} setPlateDigits={setPlateDigits} plateLetters={plateLetters} setPlateLetters={setPlateLetters} rows={rows} loading={loading} msg={msg} msgType={msgType} onDelete={deleteUser} deletingUid={deletingUid} resetSearch={resetSearch} />;
  if (section === "add-users") content = <AddUsersView newUid={newUid} setNewUid={setNewUid} newName={newName} setNewName={setNewName} newBal={newBal} setNewBal={setNewBal} plateDigits={newPlateDigits} setPlateDigits={setNewPlateDigits} plateLetters={newPlateLetters} setPlateLetters={setNewPlateLetters} addUser={addUser} successInfo={successInfo} clearSuccess={clearSuccess} openAddedUser={openAddedUser} addDisabled={!addFormComplete} addValidationMessage={addValidationMessage} />;
  if (section === "block-users") content = <BlockUsersView blockBy={blockBy} setBlockBy={setBlockBy} blockQuery={blockQuery} setBlockQuery={setBlockQuery} blockDigits={blockDigits} setBlockDigits={setBlockDigits} blockLetters={blockLetters} setBlockLetters={setBlockLetters} previewUser={blockPreview} previewLoading={blockPreviewLoading} blockUser={() => setBlocked(true)} unblockUser={() => setBlocked(false)} msg={msg} msgType={msgType} uidSuggestions={blockUidSuggestions} plateSuggestions={blockPlateSuggestions} onPickPlate={pickBlockPlate} />;
  if (section === "add-balance") content = <AddBalanceView balanceBy={balanceBy} setBalanceBy={setBalanceBy} balanceQuery={balanceQuery} setBalanceQuery={setBalanceQuery} balanceDigits={balanceDigits} setBalanceDigits={setBalanceDigits} balanceLetters={balanceLetters} setBalanceLetters={setBalanceLetters} previewUser={balancePreview} previewLoading={balancePreviewLoading} amount={amount} setAmount={setAmount} addBalance={addBalance} msg={msg} msgType={msgType} uidSuggestions={balanceUidSuggestions} plateSuggestions={balancePlateSuggestions} onPickPlate={pickBalancePlate} />;

  return (
    <div className="pageShell">
      <UsersSidebar section={section} setSection={setSection} />
      <div>{content}</div>
    </div>
  );
}
