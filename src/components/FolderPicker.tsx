import { useEffect, useState } from "react";
import { ArrowUp, Folder, LoaderCircle } from "lucide-react";
import type { IndexClient } from "../client";
import { Modal } from "./Modal";

interface DirectoryListing {
  path: string;
  parent: string;
  directories: { name: string; path: string }[];
}

// 로컬 서버의 실제 폴더를 탐색하거나 절대 경로로 선택한다.
export function FolderPicker({
  client,
  onSelect,
  onClose,
}: {
  client: IndexClient;
  onSelect: (absolutePath: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // 서버가 확인한 디렉터리만 선택할 수 있도록 목록을 갱신한다.
  async function browse(path?: string): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const next = await client.request<DirectoryListing>("directories", {
        path,
      });
      setListing(next);
      setInput(next.path);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "폴더를 읽을 수 없습니다.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void browse();
  }, [client]);

  return (
    <Modal
      title="로컬 폴더 연결"
      subtitle="서버가 실행되는 PC의 폴더를 선택하세요."
      onClose={onClose}
    >
      <div className="modal-content folder-picker">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void browse(input);
          }}
          className="folder-address"
        >
          <input
            aria-label="로컬 폴더 절대 경로"
            placeholder="폴더의 절대 경로"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="button secondary small" disabled={loading}>
            이동
          </button>
        </form>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="folder-picker-list" aria-label="로컬 하위 폴더">
          {loading ? (
            <div className="preview-empty">
              <LoaderCircle className="spin" />
              폴더를 읽고 있습니다
            </div>
          ) : (
            <>
              <button
                onClick={() => void browse(listing?.parent)}
                disabled={listing?.path === listing?.parent}
              >
                <ArrowUp size={16} />
                상위 폴더
              </button>
              {listing?.directories.map((folder) => (
                <button
                  key={folder.path}
                  onClick={() => void browse(folder.path)}
                >
                  <Folder size={16} />
                  {folder.name}
                </button>
              ))}
              {!listing?.directories.length && <p>하위 폴더가 없습니다.</p>}
            </>
          )}
        </div>
        <p className="modal-footnote">
          파일명·경로·크기·수정일을 인덱싱합니다. .git, node_modules, 심볼릭
          링크는 제외합니다.
        </p>
        <button
          className="button primary full-width"
          disabled={loading || !listing || !!error || input !== listing.path}
          onClick={() => listing && onSelect(listing.path)}
        >
          이 폴더 연결
          {listing
            ? ` · ${listing.path.split(/[\\/]/).filter(Boolean).pop() || listing.path}`
            : ""}
        </button>
      </div>
    </Modal>
  );
}
