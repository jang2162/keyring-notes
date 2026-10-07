import type { LintIssue } from "@keyring-notes/core";

/**
 * 에이전트에게 가는 글(MCP 안내·도구 설명·정리 점검 설명). 서버 설정 "에이전트 언어"(기본 영어)를 따른다.
 * LLM 에이전트는 영어 설명을 가장 안정적으로 따르므로 영어가 기본이다.
 */
export type AgentLang = "en" | "ko";

export function agentLangOf(v: unknown): AgentLang {
  return v === "ko" ? "ko" : "en";
}

export interface AgentText {
  instructions: string;
  tools: Record<string, string>;
  params: Record<string, string>;
  lint: (i: LintIssue) => string;
  hiddenCommit: string;
}

const EN: AgentText = {
  instructions: `Tools for a Keyring Notes vault (markdown notes).
- You only see paths this token may read. Check your permission table with whoami.
- Permissions: read < append (new documents, append to the end) < write (edit) < delete (delete, move).
- The vault is a tree of nodes: a node "A" is the note A.md plus its children under A/. Top-level nodes are workspaces. list_children walks the tree.
- In an LLM Wiki topic (list_topics with wiki=true; a topic is <workspace>/<name>), read <topic>/SCHEMA.md first and follow it. Start from <topic>/wiki/index.md (index and unprocessed sources).
- For long documents, look at the structure with read_outline and read only what you need with read_section.
- Pass the hash you last read as base_hash when writing. If it differs you get a conflict: read again and retry.
- search finds words of 3+ characters through the index; a '#tag' word becomes a tag filter.
- Writes under review folders come back with pending and take effect only after a person approves. Check the outcome with my_proposals.
- To change several documents together, use batch_write for one commit. If one operation fails, nothing is changed.`,
  tools: {
    whoami: "This token's agent name and per-path permission table",
    list_topics: "Topics: nodes directly under each workspace (<workspace>/<name>). wiki=true means an LLM Wiki topic (raw/, wiki/, SCHEMA.md): read SCHEMA.md before working",
    list_children: "Child nodes of a node (a node is the note A.md plus its children under A/). Without path, the workspaces. Each child has its note path (null if the node has no note), whether it has children and its attachment count",
    list_documents: "Markdown documents you can read, with your permission on each",
    read_outline: "Document outline: hash, line count, frontmatter, headings (line ranges), wikilink targets. No body.",
    read_section: "Read part of a document: heading (e.g. 'Install > Requirements', a block ID like '^p3') or start_line/end_line (1-based, inclusive)",
    read_document: "Whole document content and hash",
    list_frontmatter: "Frontmatter of the documents under a folder at once (no bodies)",
    search: "Full-text search: documents containing every space-separated word, with the first matching line",
    backlinks: "Documents that link to this one with a wikilink",
    unlinked_mentions: "Other documents where this document's name (file name, title, aliases) appears without a link, with positions (line, column, context). To turn one into a link, edit that document with write_document",
    lint: "Structural lint: broken links and sources, orphan wiki pages, pages without sources, missing frontmatter (title, summary), stale pages, uncited sources",
    sources: "Source links: what this document's frontmatter sources point to (path=null if missing or not visible), pages citing this one as a source, pages linking to it",
    semantic_search: "Semantic search (embeddings): documents and sections close in meaning even with different words. Only when the server has an embedding model configured",
    list_tags: "Tags (frontmatter tags + #tags in the body) and document counts",
    query: 'Pick documents with the same YAML query as widgets. Example: "type: table\\nfrom: Work\\nwhere: status != done\\nshow: [title, due]\\nsort: due". type: query|table|tasks|chart',
    ingest_url: "Fetch a web page or PDF, convert it to markdown and save it as a source under <topic>/raw/ (PDF originals also go to raw/assets/). Needs append on raw",
    ingest_text: "Save text you already have (a conversation, notes, a document from another tool) as a source under <topic>/raw/",
    my_proposals: "Change proposals you submitted (review queue) and their outcome (pending/approved/rejected, rejection reason)",
    write_document: "Write a whole document. New documents use base_hash=null; existing documents need the hash you last read.",
    append_document: "Append to the end of a document (created if missing). Works with append-only permission. base_hash is optional.",
    move_document:
      "Move or rename a document. Needs delete on the original location. By default links pointing to it (wikilinks, relative markdown links, frontmatter sources) are fixed in the same commit (only documents you may write, linksUpdated). update_links=false turns this off.",
    delete_document: "Delete a document (it stays in the history)",
    batch_write:
      "Several operations (write/append/delete/move) as one commit. Each is checked on top of the previous ones; if one fails nothing changes. Moves also fix links (update_links=false to turn off).",
  },
  params: {
    folder: "Only under this folder (e.g. Work/wiki)",
    fields: "Return only these keys",
    lintFolder: "Only this folder (e.g. Work/Economy)",
    staleDays: "Wiki pages not updated for more than this many days (default 180)",
    spec: "YAML",
    message: "Commit message",
    updateLinks: "Fix links on move (default true)",
    childrenPath: "Node path (e.g. Work/Project A). Empty for workspaces",
  },
  lint: (i) => {
    const p = i.params ?? {};
    switch (i.kind) {
      case "broken_link":
        return `Link [[${i.target}]] points to a missing or hidden document`;
      case "broken_source":
        return p.anchor ? `Source "${i.target}" has no ${String(p.anchor).startsWith("^") ? `block ${p.anchor}` : `heading "${p.anchor}"`}` : `Source "${i.target}" is missing or hidden`;
      case "orphan":
        return "No other document links to or cites this page";
      case "no_sources":
        return "No frontmatter sources";
      case "missing_frontmatter":
        return `Missing frontmatter: ${p.fields}`;
      case "stale":
        return `Not updated for ${p.days} days (limit ${p.limit})`;
      case "unprocessed_raw":
        return "Source not cited by any wiki page";
      case "daily_mismatch":
        return `Daily properties differ from the date in the name (${p.date}): ${p.keys}`;
    }
  },
  hiddenCommit: "(change involving hidden paths)",
};

const KO: AgentText = {
  instructions: `Keyring Notes 볼트(마크다운 노트)에 접근하는 도구입니다.
- 이 토큰이 볼 수 있는 경로만 보입니다. whoami로 권한 표를 확인하세요.
- 권한: read < append(새 문서·끝에 덧붙이기) < write(수정) < delete(삭제·이동).
- 볼트는 노드 트리입니다: 노드 "A"는 노트 A.md와 A/ 아래 하위입니다. 맨 위 노드는 워크스페이스입니다. list_children으로 트리를 따라갑니다.
- LLM Wiki 토픽(list_topics의 wiki=true, 토픽은 <워크스페이스>/<이름>)에서는 먼저 <토픽>/SCHEMA.md를 읽고 그 절차를 따르세요. 시작점은 <토픽>/wiki/index.md(목차·미반영 원본)입니다.
- 긴 문서는 read_outline으로 구조를 본 뒤 read_section으로 필요한 부분만 읽으세요.
- 쓰기에는 마지막으로 읽은 hash를 base_hash로 넘깁니다. 다르면 conflict가 나며, 다시 읽고 재시도하세요.
- search는 3글자 이상 단어를 색인으로 찾고, '#태그' 단어는 태그 조건이 됩니다.
- 검토 대상 폴더에 쓰면 결과에 pending이 붙고 사람이 승인할 때까지 반영되지 않습니다. my_proposals로 결과를 확인하세요.
- 여러 문서를 함께 고칠 때는 batch_write로 한 커밋에 묶으세요. 하나라도 실패하면 전부 취소됩니다.`,
  tools: {
    whoami: "이 토큰의 에이전트 이름과 경로별 권한 표",
    list_topics: "토픽 목록: 워크스페이스 바로 아래 노드(<워크스페이스>/<이름>). wiki=true면 LLM Wiki 토픽(raw/·wiki/·SCHEMA.md)이며 작업 전에 SCHEMA.md를 읽는다",
    list_children: "노드의 하위 노드(노드 = 노트 A.md + A/ 아래 하위). path가 없으면 워크스페이스 목록. 하위마다 노트 경로(노트 없는 노드면 null), 하위가 있는지, 첨부 수",
    list_documents: "읽을 수 있는 마크다운 문서 목록과 각 문서에 대한 권한",
    read_outline: "문서 개요: 해시, 줄 수, 프런트매터, 제목 목록(줄 범위), 위키링크 대상. 본문은 돌려주지 않는다.",
    read_section: "문서 일부 읽기. heading(예: '설치 > 요구사항', 블록 ID면 '^p3') 또는 start_line/end_line(1부터, 포함)",
    read_document: "문서 전체 내용과 hash",
    list_frontmatter: "폴더 안 문서들의 프런트매터를 한 번에 조회(본문 없이)",
    search: "전체 텍스트 검색. 공백으로 나눈 모든 단어를 포함한 문서와 첫 일치 줄",
    backlinks: "이 문서를 위키링크로 가리키는 문서 목록",
    unlinked_mentions: "이 문서의 이름(파일 이름·title·aliases)이 링크 없이 나오는 다른 문서와 그 자리(줄·위치·문맥). 링크로 바꾸려면 write_document로 그 문서를 고친다",
    lint: "구조적 정리 점검: 깨진 링크·출처, 고아 위키 페이지, 출처(sources) 없는 페이지, 프런트매터 누락(title·summary), 오래된 페이지, 인용되지 않은 원본",
    sources: "출처 연결: 이 문서의 프런트매터 sources가 가리키는 원본(없거나 볼 수 없으면 path=null), 이 문서를 출처로 인용한 페이지, 본문에서 링크한 페이지",
    semantic_search: "의미 검색(임베딩): 단어가 달라도 뜻이 가까운 문서·절. 서버에 임베딩 모델이 설정됐을 때만 쓸 수 있다",
    list_tags: "태그(프런트매터 tags + 본문 #태그)와 문서 수",
    query: '위젯과 같은 YAML 쿼리로 문서를 고른다. 예: "type: table\\nfrom: 업무\\nwhere: status != done\\nshow: [title, due]\\nsort: due". type: query|table|tasks|chart',
    ingest_url: "웹 페이지·PDF를 가져와 마크다운으로 바꿔 <topic>/raw/에 원본으로 저장한다(PDF는 raw/assets/에 원본도). raw에 append 권한 필요",
    ingest_text: "이미 가진 텍스트(대화 기록, 메모, 다른 도구로 얻은 문서)를 <topic>/raw/에 원본으로 저장한다",
    my_proposals: "내가 올린 변경 제안(검토 대기열)과 처리 결과(pending/approved/rejected, 거절 사유)",
    write_document: "문서 전체를 쓴다. 새 문서는 base_hash=null. 기존 문서는 마지막으로 읽은 hash가 필요하다.",
    append_document: "문서 끝에 덧붙인다(없으면 만든다). 추가 전용 권한으로도 쓸 수 있다. base_hash는 선택.",
    move_document:
      "문서 이동·이름 변경. 원래 위치에 delete 권한이 필요하다. 기본으로 이 문서를 가리키던 링크(위키링크·상대 마크다운 링크·프런트매터 sources)를 같은 커밋에서 고친다(쓰기 권한이 있는 문서만, linksUpdated). update_links=false면 고치지 않는다.",
    delete_document: "문서 삭제(이력에는 남는다)",
    batch_write:
      "여러 연산(write/append/delete/move)을 하나의 커밋으로. 앞 연산 결과 위에서 차례로 검사되며, 하나라도 실패하면 아무것도 바뀌지 않는다. move가 있으면 링크를 함께 고친다(update_links=false로 끔).",
  },
  params: {
    folder: "이 폴더 아래만 (예: 업무/wiki)",
    fields: "이 키만 돌려준다",
    lintFolder: "이 폴더만 (예: 업무/경제)",
    staleDays: "이 일수보다 오래 갱신 안 된 위키 페이지(기본 180)",
    spec: "YAML",
    message: "커밋 메시지",
    updateLinks: "move 때 링크 자동 갱신(기본 true)",
    childrenPath: "노드 경로(예: 업무/프로젝트A). 비우면 워크스페이스 목록",
  },
  lint: (i) => {
    const p = i.params ?? {};
    switch (i.kind) {
      case "broken_link":
        return `링크 [[${i.target}]]의 대상이 없거나 볼 수 없음`;
      case "broken_source":
        return p.anchor ? `출처 "${i.target}"에 ${String(p.anchor).startsWith("^") ? `블록 ${p.anchor}` : `제목 "${p.anchor}"`}이(가) 없음` : `출처 "${i.target}"가 없거나 볼 수 없음`;
      case "orphan":
        return "다른 문서에서 링크하거나 인용하지 않음";
      case "no_sources":
        return "프런트매터 sources(근거 원본)가 없음";
      case "missing_frontmatter":
        return `프런트매터 누락: ${p.fields}`;
      case "stale":
        return `${p.days}일 동안 갱신되지 않음(기준 ${p.limit}일)`;
      case "unprocessed_raw":
        return "어느 위키 페이지에서도 인용하지 않은 원본";
      case "daily_mismatch":
        return `데일리 속성과 이름 날짜(${p.date})가 다름: ${p.keys}`;
    }
  },
  hiddenCommit: "(숨김 경로가 포함된 변경)",
};

export function agentText(lang: AgentLang | string | undefined): AgentText {
  return agentLangOf(lang) === "ko" ? KO : EN;
}
