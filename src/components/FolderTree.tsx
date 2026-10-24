import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { IndexClient } from "../client";
import type { ConnectedRoot, FileEntry, Location } from "../types";

// 펼친 폴더의 바로 아래 폴더만 읽어 트리에 표시한다.
function Branch({
  name,
  location,
  current,
  client,
  revision,
  onNavigate,
  depth = 0,
}: {
  name: string;
  location: Location;
  current: Location;
  client: IndexClient;
  revision: number;
  onNavigate: (location: Location) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    client
      .request<FileEntry[]>("list", location)
      .then((items) => {
        if (alive)
          setChildren(items.filter((item) => item.kind === "directory"));
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [open, location.rootId, location.path, client, revision]);
  return (
    <div role="treeitem" aria-expanded={open}>
      <div
        className={`tree-folder ${current.rootId === location.rootId && current.path === location.path ? "current" : ""}`}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          className="tree-toggle"
          aria-label={`${name} ${open ? "접기" : "펼치기"}`}
          onClick={() => setOpen(!open)}
          disabled={depth >= 32}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          className="tree-name"
          title={name}
          onClick={() => onNavigate(location)}
        >
          <Folder size={13} />
          <span>{name}</span>
        </button>
      </div>
      {open && (
        <div role="group">
          {error ? (
            <span className="tree-error">{error}</span>
          ) : (
            children.map((child) => (
              <Branch
                key={child.id}
                name={child.name}
                location={{ rootId: child.rootId, path: child.path }}
                current={current}
                client={client}
                revision={revision}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// 연결된 폴더들을 탐색창별로 펼칠 수 있는 폴더 트리로 제공한다.
export function FolderTree({
  roots,
  location,
  client,
  revision,
  onNavigate,
}: {
  roots: ConnectedRoot[];
  location: Location;
  client: IndexClient;
  revision: number;
  onNavigate: (location: Location) => void;
}) {
  return (
    <aside className="folder-tree" role="tree" aria-label="폴더 트리">
      {roots.map((root) => (
        <Branch
          key={root.id}
          name={root.name}
          location={{ rootId: root.id, path: "" }}
          current={location}
          client={client}
          revision={revision}
          onNavigate={onNavigate}
        />
      ))}
    </aside>
  );
}
