
# Smart Composer (Obsidian Plugin) 구조 정리 (수도코드)

이 문서는 `obsidian-smart-composer` 프로젝트의 폴더/파일 구조와 런타임 동작을 **“수도코드(pseudocode) 수준”**으로 정리한 내부 개발용 노트입니다.

---

## 0) 한 줄 요약

- Obsidian 플러그인(엔트리: `src/main.ts`) + React(View: `ChatView`, `ApplyView`) + 로컬 DB(PGlite+Drizzle) + JSON 스토리지(채팅/템플릿) + LLM Provider(OpenAI/Claude/Gemini/…)+ RAG(Vector) + MCP(외부 Tool) 를 한 플로우로 엮은 구조

---

## 1) 최상위(루트) 파일/폴더 구조

### 루트 파일

- `package.json`
	- 개발/빌드/테스트 스크립트 정의
	- 핵심 의존성: React, TanStack Query, Drizzle, PGlite, LangChain splitter, MCP SDK, 여러 LLM SDK

- `main.js`
	- 빌드 결과물(배포되는 Obsidian 플러그인 엔트리)
	- 실제 소스는 `src/main.ts`

- `esbuild.config.mjs`
	- `src/main.ts`를 번들링하여 `main.js` 생성
	- Obsidian 환경에서 `@electric-sql/pglite`가 “Node로 오인”하지 않도록 shim 플러그인을 주입
	- 개발 모드: watch / 운영 모드: minify + `meta.json` 생성

- `import-meta-url-shim.js`
	- esbuild 번들링에서 `import.meta.url` 대체를 위한 shim

- `drizzle.config.ts`
	- Drizzle schema 위치: `./src/database/schema.ts`

- `compile-migration.js`
	- `drizzle/` 폴더의 SQL 마이그레이션 파일들을 읽어
		`src/database/migrations.json`으로 컴파일

- `drizzle/`
	- SQL 마이그레이션 파일들(벡터 확장, 테이블, 인덱스, 차원 지원 등)
	- Drizzle 런타임 마이그레이션에서 사용됨

- `pglite/`
	- 브라우저 환경에서 PGlite가 사용할 바이너리 자산들
	- `scripts/copy-pglite-assets.mjs`로 `node_modules/@electric-sql/pglite/dist/`에서 복사됨
	- 포함 파일 예: `postgres.wasm`, `postgres.data`, `vector.tar.gz`

- `scripts/`
	- 빌드/운영에 필요한 보조 스크립트 모음

- 기타 설정/문서 파일(구성 이해용)
	- `tsconfig.json`: TypeScript 컴파일 옵션
	- `jest.config.js` + `__mocks__/`: 테스트 설정/모킹
	- `README.md`, `DEVELOPMENT.md`, `CONTRIBUTING.md`: 사용/개발 가이드
	- `LICENSE`: 라이선스

---

## 2) 빌드/개발 스크립트(개발자 관점)

`package.json` scripts 요약:

```text
npm run dev
	-> scripts/copy-pglite-assets.mjs 실행
	-> esbuild watch (src/main.ts -> main.js)

npm run build
	-> scripts/copy-pglite-assets.mjs 실행
	-> tsc -noEmit (타입체크)
	-> esbuild production (main.js 생성)

npm run migrate:compile
	-> drizzle/ 의 SQL들을 읽어 src/database/migrations.json 생성

npm run test
	-> jest
```

---

## 3) `src/` 전체 구조 개괄

대략적인 트리(핵심 폴더만):

```text
src/
	main.ts                # Obsidian Plugin 엔트리
	ChatView.tsx            # Obsidian ItemView + React Root
	ApplyView.tsx           # Obsidian View + React Root
	constants.ts            # 모델/프로바이더/뷰 타입 등 상수

	components/
		chat-view/            # 채팅 UI + 입력(Lexical) + 스트리밍 + 툴/진행상태
		apply-view/           # Apply(수정 적용) 화면
		settings/             # SettingTab의 React UI
		modals/               # ErrorModal 등
		common/               # 공용 UI

	contexts/               # React Context Provider 모음

	core/
		llm/                  # Provider별 구현 + 선택 매니저
		rag/                  # RAGEngine (VectorManager + Embedding)
		mcp/                  # MCP 서버 연결/툴 호출 관리

	database/
		DatabaseManager.ts    # PGlite + Drizzle 로딩/저장/마이그레이션
		schema.ts             # embeddings/template 등 테이블 + 인덱스
		migrations.json       # drizzle/에서 컴파일된 마이그레이션
		modules/              # (레거시) template/vector 관리 모듈
		json/                 # (신규) 채팅/템플릿 JSON 저장소

	hooks/                  # useChatHistory/useJsonManagers 등
	settings/               # 설정 schema/파싱/마이그레이션
	types/                  # 채팅/모델/프로바이더/MCP/툴콜/멘셔너블 타입
	utils/                  # Obsidian/LLM/token/chat 유틸
```

---

## 4) 런타임 아키텍처(큰 그림)

### 4.1 Obsidian 플러그인 엔트리: `src/main.ts`

핵심 역할:
- 플러그인 설정 로드/검증/마이그레이션
- View 등록(`ChatView`, `ApplyView`)
- 리본 아이콘/명령 등록(채팅 열기, 선택영역 추가, RAG 인덱스 갱신 등)
- DB/RAG/MCP 매니저를 **lazy-init**
- 레거시 데이터(JSON DB로) 마이그레이션 수행

수도코드:

```ts
class SmartComposerPlugin extends Plugin {
	settings
	initialChatProps?
	settingsChangeListeners = []
	mcpManager = null
	dbManager = null
	ragEngine = null
	dbManagerInitPromise = null
	ragEngineInitPromise = null
	timeoutIds = []

	async onload() {
		await loadSettings()

		registerView(CHAT_VIEW_TYPE, leaf => new ChatView(leaf, this))
		registerView(APPLY_VIEW_TYPE, leaf => new ApplyView(leaf))

		addRibbonIcon("wand-sparkles", () => openChatView())
		addCommand("open-new-chat", () => openChatView(true))
		addCommand("add-selection-to-chat", editorCallback => addSelectionToChat())
		addCommand("rebuild-vault-index", () => ragEngine.updateVaultIndex({reindexAll:true}, progress => Notice 업데이트))
		addCommand("update-vault-index", () => ragEngine.updateVaultIndex({reindexAll:false}, progress => Notice 업데이트))

		addSettingTab(new SmartComposerSettingTab(app, this))

		// 백그라운드로 1회성 마이그레이션
		void migrateToJsonStorage()
	}

	onunload() {
		clear all timeouts
		ragEngine.cleanup(); ragEngine=null
		dbManager.cleanup(); dbManager=null
		mcpManager.cleanup(); mcpManager=null
	}

	async loadSettings() {
		settings = parseSmartComposerSettings(await loadData())
		saveData(settings) // defaults 반영
	}

	async setSettings(newSettings) {
		validate with zod
		settings = newSettings
		saveData(newSettings)
		ragEngine?.setSettings(newSettings)
		notify listeners
	}

	async openChatView(openNewChat=false) {
		if active markdown editor exists:
			selectedBlock = getMentionableBlockData(editor, view)
			activateChatView({selectedBlock}, openNewChat)
		else:
			activateChatView(undefined, openNewChat)
	}

	async activateChatView(chatProps?, openNewChat=false) {
		initialChatProps = chatProps
		leaf = existing chat leaf or right leaf
		leaf.setViewState({type: CHAT_VIEW_TYPE})
		if openNewChat: leaf.view.openNewChat(selectedBlock)
		reveal leaf
	}

	async addSelectionToChat(editor, view) {
		data = getMentionableBlockData(...)
		if no chat leaf: activateChatView({selectedBlock:data})
		else: chatView.addSelectionToChat(data); chatView.focusMessage()
	}

	async getDbManager() {
		if dbManager exists return
		if no initPromise:
			initPromise = DatabaseManager.create(app, plugin)
				-> handle PGLiteAbortedException => show installer modal
		return initPromise
	}

	async getRAGEngine() {
		if ragEngine exists return
		if no initPromise:
			initPromise = new RAGEngine(app, settings, (await getDbManager()).getVectorManager())
		return initPromise
	}

	async getMcpManager() {
		if mcpManager exists return
		mcpManager = new McpManager({settings, registerSettingsListener:addSettingsChangeListener})
		await mcpManager.initialize()
		return mcpManager
	}

	async migrateToJsonStorage() {
		dbManager = await getDbManager()
		migrateToJsonDatabase(app, dbManager, async () => reloadChatView())
	}
}
```

---

## 5) UI 레이어: View ↔ React

### 5.1 `src/ChatView.tsx`

역할:
- Obsidian `ItemView`로 사이드 패널 뷰 생성
- `createRoot(...).render(...)`로 React 앱 마운트
- React Context Provider들을 한 번에 “의존성 주입”

Provider 체인(중요):

```tsx
<ChatViewProvider chatView={this}>
	<PluginProvider plugin={plugin}>
		<AppProvider app={obsidianApp}>
			<SettingsProvider settings={plugin.settings} setSettings={plugin.setSettings} ...>
				<DarkModeProvider>
					<DatabaseProvider getDatabaseManager={plugin.getDbManager}>
						<RAGProvider getRAGEngine={plugin.getRAGEngine}>
							<McpProvider getMcpManager={plugin.getMcpManager}>
								<QueryClientProvider>
									<DialogContainerProvider container={...}>
										<Chat ref={chatRef} {...initialChatProps} />
									</DialogContainerProvider>
								</QueryClientProvider>
							</McpProvider>
						</RAGProvider>
					</DatabaseProvider>
				</DarkModeProvider>
			</SettingsProvider>
		</AppProvider>
	</PluginProvider>
</ChatViewProvider>
```

### 5.2 `src/ApplyView.tsx`

역할:
- Apply(파일 수정 적용) 화면 전용 View
- `ApplyViewState`(file/original/newContent) 기반으로 `ApplyViewRoot` 렌더

```ts
class ApplyView extends View {
	state: { file, originalContent, newContent }

	async setState(next) { state = next; render() }
	onOpen() { root = createRoot(containerEl) }
	onClose() { root.unmount() }
	render() {
		if (!state) return
		root.render(
			<AppProvider app={obsidianApp}>
				<ApplyViewRoot state={state} close={() => leaf.detach()} />
			</AppProvider>
		)
	}
}
```

---

## 6) 핵심 기능 플로우: Chat(대화) → LLM → (RAG/MCP) → UI

### 6.1 Chat 컴포넌트: `src/components/chat-view/Chat.tsx`

핵심 상태:
- `currentConversationId`: UUID
- `chatMessages`: 사용자/어시스턴트/툴 메시지의 배열
- `inputMessage`: 현재 입력(기본으로 current-file mentionable 포함)
- `queryProgress`: RAG 진행 상태(mentionables 읽기/인덱싱/쿼리/완료)

주요 훅:
- `useChatHistory()` : JSON DB 기반 대화 저장/로드
- `useChatStreamManager()` : LLM 스트리밍 + ResponseGenerator 구동
- `PromptGenerator` : user message + mentionables + (옵션)RAG를 모델 입력 prompt로 변환

#### 6.1.0 메시지/대화 타입(개발 시 기준): `src/types/chat.ts`

이 프로젝트에서 “대화”는 `ChatMessage[]`이며, 저장 시에는 Obsidian Vault에 JSON으로 저장되므로 **직렬화 타입(SerializedChatMessage)**가 별도로 존재합니다.

```ts
ChatMessage = ChatUserMessage | ChatAssistantMessage | ChatToolMessage

ChatUserMessage {
	role:'user'
	content: SerializedEditorState | null           // Lexical editorState
	promptContent: string | ContentPart[] | null    // 컴파일된 prompt(문자열/멀티파트)
	mentionables: Mentionable[]
	similaritySearchResults?: ChunkWithSimilarity[]
	id: string
}

ChatAssistantMessage {
	role:'assistant'
	content: string
	reasoning?: string
	annotations?: Annotation[]
	toolCallRequests?: ToolCallRequest[]
	metadata?: { usage?: ResponseUsage, model?: ChatModel }
	id: string
}

ChatToolMessage {
	role:'tool'
	id: string
	toolCalls: [{ request: ToolCallRequest, response: ToolCallResponse }]
}

// UI에서 assistant + tool 메시지를 “한 덩어리”로 묶어 액션(복사/usage)을 제공
AssistantToolMessageGroup = (ChatAssistantMessage | ChatToolMessage)[]

// 저장용(Serialized*)은 mentionables가 SerializedMentionable[]로 변환됨
SerializedChatMessage = SerializedChatUserMessage | ...
```

수도코드(사용자 메시지 제출):

```ts
async function handleUserMessageSubmit({ inputChatMessages, useVaultSearch }) {
	abortActiveStreams()
	setQueryProgress('idle')
	setChatMessages(inputChatMessages)
	forceScrollToBottom()

	lastMessage = inputChatMessages.last()
	assert(lastMessage.role === 'user')

	// 마지막 user message는 useVaultSearch 여부에 따라 RAG 포함하여 promptContent로 컴파일
	compiledMessages = await Promise.all(
		inputChatMessages.map(msg => {
			if (msg.role==='user' && msg.id===lastMessage.id)
				return promptGenerator.compileUserMessagePrompt({message: msg, useVaultSearch, onQueryProgressChange:setQueryProgress})
			if (msg.role==='user' && !msg.promptContent)
				return promptGenerator.compileUserMessagePrompt({message: msg})
			return msg
		})
	)

	setChatMessages(compiledMessages)
	submitChatMutation.mutate({ chatMessages: compiledMessages, conversationId })
}
```

### 6.1.1 Chat 입력 편집기(Lexical) 구조

Chat 화면의 입력창은 Lexical 기반이며, “텍스트 + 멘션 노드(MentionNode)” 조합으로 입력 내용을 구성합니다.

핵심 파일:
- 입력 컴포저: `src/components/chat-view/chat-input/LexicalContentEditable.tsx`
- 멘션(@) 타입헤드: `src/components/chat-view/chat-input/plugins/mention/MentionPlugin.tsx`
- URL 자동 링크(멘션 노드로 변환): `src/components/chat-view/chat-input/plugins/mention/AutoLinkMentionPlugin.tsx`
- 템플릿(/) 타입헤드: `src/components/chat-view/chat-input/plugins/template/TemplatePlugin.tsx`
- 선택영역 템플릿 생성 버튼: `src/components/chat-view/chat-input/plugins/template/CreateTemplatePopoverPlugin.tsx`

LexicalContentEditable 수도코드:

```tsx
function LexicalContentEditable({
	editorRef,
	contentEditableRef,
	onChange,
	onEnter,
	onMentionNodeMutation,
	onCreateImageMentionables,
	initialEditorState,
	autoFocus,
	plugins,
}) {
	app = useApp()
	initialConfig = {
		namespace: 'LexicalContentEditable',
		nodes: [MentionNode],
		editorState: initialEditorState,
		theme: { root: ..., paragraph: ... },
		onError: console.error,
	}

	searchResultByQuery = (query) => fuzzySearch(app, query)

	if (autoFocus) requestAnimationFrame(() => contentEditableRef.current?.focus())

	return (
		<LexicalComposer initialConfig>
			<RichTextPlugin contentEditable={<ContentEditable ... ref={contentEditableRef} />} />
			<HistoryPlugin />
			<MentionPlugin searchResultByQuery={searchResultByQuery} />
			<OnChangePlugin onChange={state => onChange?.(state.toJSON())} />
			<OnEnterPlugin onEnter={onEnter} onVaultChat={plugins?.onEnter?.onVaultChat} />
			<OnMutationPlugin nodeClass={MentionNode} onMutation={onMentionNodeMutation} />
			<EditorRefPlugin editorRef={editorRef} />
			<NoFormatPlugin />
			<AutoLinkMentionPlugin />
			<ImagePastePlugin onCreateImageMentionables={onCreateImageMentionables} />
			<DragDropPastePlugin onCreateImageMentionables={onCreateImageMentionables} />
			<TemplatePlugin />
			<CreateTemplatePopoverPlugin anchorElement={plugins?.templatePopover?.anchorElement} />
		</LexicalComposer>
	)
}
```

#### (A) Enter 처리: `OnEnterPlugin`

```ts
on KEY_ENTER:
	if (ctrl/cmd + shift + enter) and onVaultChat exists:
		preventDefault(); onVaultChat(); return true
	if (shift+enter):
		return false // 줄바꿈 허용
	preventDefault(); onEnter(evt); return true
```

#### (B) 텍스트 포맷 제거: `NoFormatPlugin`

RichTextPlugin을 쓰면서도 “멘션 노드 복사/붙여넣기” 안정성을 위해 텍스트 포맷을 0으로 강제합니다.

```ts
on TextNode transform:
	if node.format != 0: node.setFormat(0)
```

#### (C) URL 자동 멘션 변환: `AutoLinkMentionPlugin`

- 붙여넣기 시: 텍스트에서 URL 패턴을 찾아 URL 부분을 MentionNode로 삽입
- 타이핑 중: TextNode transform에서 URL 후보를 찾고, “커서가 URL 끝에 있지 않으면” MentionNode로 치환

```ts
on PASTE_COMMAND:
	text = clipboard.getText('text/plain')
	urls = findURLs(text)
	if none: return false
	selection.insertNodes([ textNodes + MentionNode(url) + spaces ])
	return true

on TextNode transform:
	if node isSimpleText:
		urlMatch = first URL in node.text
		if cursor is exactly at end of urlMatch: return // 입력 중 방해 금지
		splitText to isolate url chunk
		replace url chunk with MentionNode(type='url') + trailing space
```

#### (D) 이미지 붙여넣기/드래그드롭: `ImagePastePlugin`, `DragDropPastePlugin`

입력창 자체에 이미지를 “텍스트로 삽입”하진 않고, 클립보드/드래그드롭의 이미지 파일들을 `MentionableImage[]`로 변환하여 상위(채팅 입력 상태)로 전달합니다.

```ts
on PASTE_COMMAND:
	images = clipboard.files.filter(type startsWith 'image/')
	if none: return false
	mentionables = await Promise.all(images.map(fileToMentionableImage))
	onCreateImageMentionables?.(mentionables)
	return true

on DRAG_DROP_PASTE:
	images = files.filter(type startsWith 'image/')
	mentionables = await Promise.all(images.map(fileToMentionableImage))
	onCreateImageMentionables?.(mentionables)
	return true
```

#### (E) 멘션(@) 타입헤드 + fuzzy search: `MentionPlugin` + `src/utils/fuzzy-search.ts`

- 트리거는 `@`.
- **중요**: 같은 커서 위치에서 `/`(템플릿 트리거)가 감지되면, 멘션 팝오버를 띄우지 않음(슬래시와 상호 배제).
- 검색 소스는 Obsidian vault의 markdown 파일/폴더 + “vault” 가상 항목.

멘션 선택 시:

```ts
onSelect(mentionable):
	mentionNode = MentionNode(name, serializeMentionable(mentionable))
	replace nodeToReplace with mentionNode
	insert trailing space
	move cursor after space
```

`fuzzySearch(app, query)` 핵심 개념:
- fuzzysort를 path/name 키로 수행
- score에 boost를 추가:
	- 열린 파일(open files) 우선
	- 최근 수정 파일 우선
	- 현재 파일과 “거리”(calculateFileDistance) 가까운 항목 우선
	- query가 비었으면 base score로 정렬 후 상위 N개 반환

#### (F) 템플릿(/) 타입헤드 + 삽입: `TemplatePlugin`

- 트리거는 `/`.
- 템플릿은 JSON 템플릿 매니저(`useTemplateManager`)에서 검색
- 선택 시 “저장된 Lexical nodes 배열”을 `$parseSerializedNode`로 복원해 입력 문서에 splice

```ts
onQueryChange(queryString):
	searchResults = await templateManager.searchTemplates(queryString)

onSelect(template, nodeToRemove):
	parsedNodes = template.content.nodes.map($parseSerializedNode)
	parent.splice(nodeToRemove.index, 1, parsedNodes)
	parsedNodes.last().selectEnd()
```

#### (G) 선택영역 기반 템플릿 생성: `CreateTemplatePopoverPlugin`

- contentEditable 내부에서 selection이 “collapsed가 아니면” 버튼을 selection 근처에 띄움
- 클릭 시 선택된 노드를 `$generateJSONFromSelectedNodes`로 직렬화하여 `CreateTemplateModal`에 전달

```ts
on SELECTION_CHANGE:
	if selection.collapsed or selection outside contentEditable:
		close popover
	else:
		position button near selection rect

onClick:
	selectedNodes = $generateJSONFromSelectedNodes(editor, selection).nodes
	open CreateTemplateModal({ selectedSerializedNodes: selectedNodes })
```

대화 저장(useEffect):

```ts
useEffect(() => {
	if (chatMessages.length > 0)
		createOrUpdateConversation(currentConversationId, chatMessages)
}, [chatMessages])
```

### 6.2 Stream/응답 생성: `useChatStreamManager` + `ResponseGenerator`

핵심 아이디어:
- UI는 `submitChatMutation` 실행 → `ResponseGenerator.run()`을 통해 스트리밍 응답을 받아 `chatMessages`에 append
- 도구 호출(tool_calls)이 생성되면, 별도의 `tool` 메시지를 만들고 MCP로 실행한 뒤 결과를 `tool` 메시지에 채움
- 모든 tool call이 완료되면(성공/에러), 자동으로 한 번 더 LLM 응답을 재개(“tool 결과를 보고 후속 응답 생성”)

수도코드:

```ts
submitChatMutation({chatMessages, conversationId}) {
	abortActiveStreams()
	abortController = new AbortController()

	providerClient, model = getChatModelClient(settings.chatModelId)
	mcpManager = await getMcpManager()

	responseGenerator = new ResponseGenerator({
		providerClient,
		model,
		messages: chatMessages,
		conversationId,
		enableTools: settings.chatOptions.enableTools,
		maxAutoIterations: settings.chatOptions.maxAutoIterations,
		promptGenerator,
		mcpManager,
		abortSignal: abortController.signal,
	})

	unsubscribe = responseGenerator.subscribe((responseMessages) => {
		// 기존 메시지(마지막 메시지까지) + responseMessages로 교체/append
		setChatMessages(prev => mergeFromLastMessage(prev, responseMessages))
		autoScrollToBottom()
	})

	await responseGenerator.run()
	unsubscribe()
}
```

`ResponseGenerator.run()`(핵심 로직 요약):

```ts
for i in 0..maxAutoIterations-1:
	{ toolCallRequests } = await streamSingleResponse()
	if toolCallRequests is empty: return

	toolMessage = {
		role:'tool',
		toolCalls: toolCallRequests.map(req => ({
			request:req,
			response: allowed(conversationId, req.name) ? 'Running' : 'PendingApproval'
		}))
	}
	emit(toolMessage)

	// auto-execution 허용된 tool만 바로 실행
	await Promise.all(toolCalls where status==='Running':
		result = await mcpManager.callTool({name:req.name, args:req.arguments, id:req.id})
		update toolMessage.toolCalls[req.id].response = result
	)

	if any toolCall not in {Success, Error}: return
```

### 6.3 메시지 렌더링(Assistant/User) & Markdown 출력

채팅 UI는 “저장된 메시지(텍스트/태그/멘션) + 모델 응답 메타데이터(usage/annotation) + RAG 결과”를 조합해 화면을 구성합니다.

#### (A) Assistant 메시지 본문 파싱/렌더: `src/components/chat-view/AssistantMessageContent.tsx`

핵심 아이디어:
- 모델 응답 문자열을 태그 단위로 파싱(`parseTagContents`)
- 파싱 결과를 블록 타입별로 렌더
	- 일반 문자열: Obsidian Markdown으로 렌더
	- `<think>...</think>`: Reasoning 접기/펼치기 UI
	- 코드 블록/적용 블록: Code component + Apply 핸들러
	- 파일 참조 블록(파일명+라인): Reference block

```tsx
AssistantMessageContent({content, contextMessages, handleApply, isApplying}) {
	onApply(block) => handleApply(block, contextMessages)
	return <AssistantTextRenderer onApply={onApply} isApplying>{content}</AssistantTextRenderer>
}

AssistantTextRenderer({children}) {
	blocks = parseTagContents(children)
	return blocks.map(block => {
		if block.type==='string':
			return <ObsidianMarkdown content={block.content} />
		if block.type==='think':
			return <AssistantMessageReasoning reasoning={block.content} />
		if block has filename+startLine+endLine:
			return <MarkdownReferenceBlock ... />
		else:
			return <MarkdownCodeComponent language filename onApply isApplying>{block.content}</MarkdownCodeComponent>
	})
}
```

##### (A-1) 태그 파서: `src/utils/chat/parse-tag-content.ts`

Assistant 응답 문자열에서 아래 태그를 “구조화된 블록”으로 분리합니다.

- `<think>...</think>`: reasoning 블록(접기/펼치기용)
- `<smtcmp_block ...attrs>...</smtcmp_block>`: 코드/적용/참조 블록
	- optional attrs: `language`, `filename`, `startline`, `endline`

구현 포인트:
- `parse5.parseFragment(..., { sourceCodeLocationInfo:true })`로 원문 offset을 얻고,
  offset 범위를 이용해 원문에서 substring을 잘라냅니다.
- 블록 content는 앞/뒤 단일 개행 1개씩을 제거합니다.

수도코드:

```ts
fragment = parseFragment(input, {sourceCodeLocationInfo:true})
lastEndOffset=0
for node in fragment.childNodes:
	if nodeName == 'smtcmp_block' or 'think':
		push preceding string chunk if any
		attrs = read node.attrs
		inner = slice input by childNodes source offsets (or '')
		push {type, content: inner, language?, filename?, startLine?, endLine?}
		lastEndOffset = node.endOffset
push trailing string if any
trim single leading/trailing newline for each block.content
```

##### (A-2) 코드 블록 UI(+Apply): `src/components/chat-view/MarkdownCodeComponent.tsx`

- 헤더: (선택) filename 클릭 시 해당 파일 열기
- 버튼: formatted/raw 토글, copy, apply
- preview 모드에서는 ObsidianMarkdown으로 렌더(마크다운이면 wrapLines=true)

```ts
onApplyButton:
	if not isApplying: onApply(String(children))

onOpenFile:
	if filename: openMarkdownFile(app, filename)
```

##### (A-3) 파일 참조 블록 UI: `src/components/chat-view/MarkdownReferenceBlock.tsx`

assistant 응답이 `<smtcmp_block filename startline endline>`을 포함하면,
UI에서 해당 파일의 해당 라인 범위를 읽어 렌더링합니다.

```ts
useEffect:
	file = app.vault.getFileByPath(filename)
	fileContent = readTFileContent(file)
	blockContent = fileContent.split('\n').slice(startLine-1, endLine).join('\n')

onOpenFile:
	openMarkdownFile(app, filename, startLine)
```

#### (B) Reasoning UI: `src/components/chat-view/AssistantMessageReasoning.tsx`

- 기본은 접힘
- reasoning 내용이 스트리밍으로 “추가 갱신”되면 로더 표시 + (사용자가 아직 토글 안 했으면) 자동 펼침

```ts
if reasoning changed and previous != '':
	showLoader=true for 1s
	if user never toggled: isExpanded=true
```

#### (C) Source/Annotation UI: `src/components/chat-view/AssistantMessageAnnotations.tsx`

- annotation 배열을 링크 목록으로 렌더(`annotation.url_citation.{url,title}`)
- 토글로 접기/펼치기

#### (D) Obsidian Markdown 렌더: `src/components/chat-view/ObsidianMarkdown.tsx`

일반 React markdown 렌더러가 아니라 Obsidian 내장 `MarkdownRenderer`를 사용합니다.

```ts
useEffect(renderMarkdown):
	container.innerHTML=''
	MarkdownRenderer.render(app, content, container, activeFilePath, chatView)
	setupMarkdownLinks(app, container, sourcePath)

setupMarkdownLinks():
	for each a.internal-link:
		on click => app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt))
		(optional hover => app.workspace.trigger('hover-link', ...))
```

#### (E) RAG 결과 표시: `src/components/chat-view/SimilaritySearchResults.tsx`

- “Show Referenced Documents (N)” 토글
- 각 chunk 클릭 시 해당 파일을 열고 startLine으로 이동: `openMarkdownFile(app, chunk.path, chunk.metadata.startLine)`

#### (F) 진행상태 표시: `src/components/chat-view/QueryProgress.tsx`

`PromptGenerator.compileUserMessagePrompt()`와 `VectorManager.updateVaultIndex()`가 단계별로 업데이트하는 상태를 표시합니다.

```ts
state.type in {
	'reading-mentionables',
	'indexing' {completedChunks,totalChunks,totalFiles,waitingForRateLimit?},
	'querying',
	'querying-done' {queryResult},
	'idle'
}
```

#### (G) LLM 응답 메타(토큰/가격) 표시: `src/components/chat-view/LLMResponseInfoPopover.tsx`

- usage가 있으면 input/output/total 토큰 + estimated price + model 표시
- usage가 없으면 “not available” 메시지

#### (H) Tool call 승인/결과 UI: `src/components/chat-view/ToolMessage.tsx`

`ResponseGenerator`가 생성한 `ChatToolMessage`를 렌더하며, tool call마다 상태/파라미터/결과를 표시합니다.

상태:
- PendingApproval, Rejected, Running, Success, Error, Aborted

수도코드:

```tsx
ToolMessage(message):
	for each toolCall in message.toolCalls:
		render ToolCallItem(request, response)

ToolCallItem:
	show header (status + server:tool) and toggle expand
	if expanded:
		show Parameters JSON (pretty print if possible)
		show Result or Error
	if status==PendingApproval:
		Allow -> callTool() and close
		Always allow this tool -> callTool(); setSettings(mcp.servers[server].toolOptions[tool].allowAutoExecution=true)
		Allow for this chat -> callTool(); mcpManager.allowToolForConversation(toolName, conversationId)
		Reject -> response=Rejected
	if status==Running:
		Abort -> mcpManager.abortToolCall(request.id); response=Aborted
```

#### (I) Assistant+Tool 메시지 그룹 & 액션: `src/components/chat-view/AssistantToolMessageGroupItem.tsx`

UI는 “assistant 메시지들 + 그 사이의 tool 메시지들”을 한 그룹으로 묶어 하단에 액션을 제공합니다.

```tsx
AssistantToolMessageGroupItem(messages):
	for message in messages:
		if assistant:
			render Reasoning/Annotations/Content
		else tool:
			render ToolMessage (승인/실행 버튼 포함)
	render AssistantToolMessageGroupActions(messages)
```

`AssistantToolMessageGroupActions`:
- Copy: assistant content + tool call summary를 합쳐 클립보드 복사
- LLM info: 그룹 내 assistant 메시지들의 usage를 합산 + 모델 기반 비용(estimate) 계산 후 popover 표시

---

---

## 7) Prompt 생성: Mentionables + RAG + 멀티미디어

### 7.1 mentionable 개념

사용자가 채팅 입력에 붙일 수 있는 컨텍스트 단위:

- `current-file`: 현재 활성 파일(옵션으로 파일 내용을 prompt에 포함)
- `file`: 특정 노트 파일
- `folder`: 특정 폴더(내부 파일을 재귀적으로 수집)
- `vault`: “볼트 전체 검색(RAG)” 트리거 용도
- `block`: 특정 파일의 라인 범위/블록(선택 영역)
- `url`: 웹페이지(내용 추출/마크다운 변환)
- `image`: base64 이미지(모델이 지원하는 형태로 전달)

직렬화/역직렬화(대화 저장용): `src/utils/chat/mentionable.ts`

```ts
serializeMentionable(Mentionable) -> SerializedMentionable
deserializeMentionable(SerializedMentionable, app) -> Mentionable | null
getMentionableKey(...) -> stable key (dedupe/삭제/선택용)
```

### 7.2 `PromptGenerator` 핵심: `src/utils/chat/promptGenerator.ts`

역할:
- 현재 대화 메시지 배열을 LLM API 형식(RequestMessage[])으로 변환
- 마지막 user message 기준으로:
	- mentionables(파일/폴더/URL/이미지/블록/볼트) 내용을 prompt에 합성
	- 토큰 임계치 초과 또는 vault mention 시 RAG 사용
	- RAG 결과를 “참고 컨텍스트”로 붙임

수도코드(개략):

```ts
async generateRequestMessages({messages}) {
	compiled = ensureAllUserMessagesHavePromptContent(messages)
	lastUser = findLastUserMessage(compiled)

	shouldUseRAG = lastUser.similaritySearchResults != undefined

	systemMessage = getSystemMessage(shouldUseRAG)
	customInstruction = getCustomInstructionMessage()

	if settings.chatOptions.includeCurrentFileContent:
		currentFileMessage = getCurrentFileMessage(lastUser.currentFile)

	historyMessages = getChatHistoryMessages(compiled.slice(-MAX_CONTEXT_MESSAGES))

	if shouldUseRAG && modelPromptLevel == Default:
		ragInstruction = getRagInstructionMessage()

	return [systemMessage, customInstruction?, currentFileMessage?, ...historyMessages, ragInstruction?]
}
```

수도코드(마지막 user message 컴파일):

```ts
async compileUserMessagePrompt({message, useVaultSearch?, onQueryProgressChange?}) {
	if message.content is null: return {promptContent:'', shouldUseRAG:false}

	query = editorStateToPlainText(message.content)

	onQueryProgressChange('reading-mentionables')
	files = mentionables.filter(type=file)
	folders = mentionables.filter(type=folder)
	nestedFiles = folders.flatMap(getNestedFiles)
	allFiles = files + nestedFiles
	fileContents = readMultipleTFiles(allFiles)

	shouldUseRAG = useVaultSearch || mentionables.includes('vault') || tokenCount(all fileContents) > settings.ragOptions.thresholdTokens

	if shouldUseRAG:
		similaritySearchResults = ragEngine.processQuery({query, scope?})
		filePrompt = buildPromptFromSimilarityResults(similaritySearchResults)
	else:
		filePrompt = inlineAllFilesContent(allFiles)

	urlPrompt = fetch+extract+markdown(url mentionables)
	imagePrompt = attach image parts
	blockPrompt = embed selected blocks

	promptContent = combine(filePrompt, urlPrompt, imagePrompt, blockPrompt, query)
	return {promptContent, shouldUseRAG, similaritySearchResults?}
}
```

---

## 8) RAG(벡터 검색) 구조

### 8.1 `RAGEngine`: `src/core/rag/ragEngine.ts`

역할:
- settings 기반으로 embedding client 구성
- 질의 시 인덱스 업데이트 전략(현재는 매 쿼리마다 update)
- `VectorManager`를 이용해 유사도 검색 수행

수도코드:

```ts
class RAGEngine {
	constructor(app, settings, vectorManager) {
		embeddingModel = getEmbeddingModelClient(settings.embeddingModelId)
	}

	setSettings(next) { settings=next; embeddingModel = getEmbeddingModelClient(...) }

	async updateVaultIndex({reindexAll}, onProgress?) {
		vectorManager.updateVaultIndex(embeddingModel, {
			chunkSize: settings.ragOptions.chunkSize,
			excludePatterns: settings.ragOptions.excludePatterns,
			includePatterns: settings.ragOptions.includePatterns,
			reindexAll
		}, onProgress)
	}

	async processQuery({query, scope, onQueryProgressChange}) {
		await updateVaultIndex({reindexAll:false}, onQueryProgressChange)
		queryEmbedding = embeddingModel.getEmbedding(query)
		onQueryProgressChange('querying')
		results = vectorManager.performSimilaritySearch(queryEmbedding, embeddingModel, {
			minSimilarity: settings.ragOptions.minSimilarity,
			limit: settings.ragOptions.limit,
			scope
		})
		onQueryProgressChange('querying-done', results)
		return results
	}
}
```

### 8.2 `VectorManager`: `src/database/modules/vector/VectorManager.ts`

역할:
- Obsidian Vault의 마크다운 파일을 읽어 청크로 분해
- 청크마다 임베딩 생성(레이트리밋 백오프 포함)
- DB에 저장/갱신/삭제
- 진행률 업데이트 + 실패 파일/청크에 대한 ErrorModal

인덱싱 개략 수도코드:

```ts
async updateVaultIndex(embeddingModel, {chunkSize, excludePatterns, includePatterns, reindexAll}, updateProgress?) {
	if reindexAll:
		filesToIndex = getFilesToIndex(reindexAll=true)
		repository.clearAllVectors(embeddingModel)
	else:
		deleteVectorsForDeletedFiles(embeddingModel)
		filesToIndex = getFilesToIndex(reindexAll=false) // 신규/수정된 파일만
		repository.deleteVectorsForMultipleFiles(filesToIndex.paths, embeddingModel)

	if filesToIndex empty: return

	// 파일 -> (헤더 섹션) -> (섹션 내부 chunkSize 기준 청크)
	contentChunks = filesToIndex.flatMap(file => {
		content = vault.cachedRead(file)
		sanitized = content.replace(/\x00/g,'')
		sections = splitMarkdownIntoHeaderSections(sanitized, maxHeaderLevel=3)
		return sections.flatMap(section => {
			if section.content blank: []
			if section.content.length <= chunkSize:
				return [{content: section.content, metadata: {startLine/endLine/headerPath/parentStartLine/parentEndLine}}]
			else:
				docs = RecursiveCharacterTextSplitter(markdown).createDocuments([section.content])
				return docs.map(doc => ({content: doc.pageContent, metadata: loc->line mapping + header info}))
		})
	})

	updateProgress({completedChunks:0, totalChunks:contentChunks.length, totalFiles:filesToIndex.length})

	// 100개 단위 batch
	for batch of chunkArray(contentChunks, 100):
		embeddingChunks = await Promise.all(batch.map(chunk => backOff(async () => {
			embeddingText = chunk.metadata.headerPath ? `Header: ${headerPath}\n\n${chunk.content}` : chunk.content
			embedding = embeddingModel.getEmbedding(embeddingText)
			updateProgress(++completedChunks, waitingForRateLimit? )
			return {path, mtime, content, model: embeddingModel.id, dimension: embeddingModel.dimension, embedding, metadata}
		}, retryIf429 up to 8 attempts)))

		valid = embeddingChunks.filter(not null)
		if valid empty and batch not empty: throw
		repository.insertVectors(valid)

	finally:
		requestSave()
}
```

### 8.3 `VectorRepository`: `src/database/modules/vector/VectorRepository.ts`

`VectorManager`가 “인덱싱/청크/임베딩 생성”을 담당한다면, `VectorRepository`는 Drizzle ORM을 통해 실제 SQL 쿼리를 수행합니다.

핵심 API 수도코드:

```ts
getIndexedFilePaths(embeddingModel):
	select path from embeddings where model = embeddingModel.id

getVectorsByFilePath(path, embeddingModel):
	select * from embeddings where path=... and model=...

deleteVectorsForSingleFile(path, embeddingModel):
	delete from embeddings where path=... and model=...

deleteVectorsForMultipleFiles(paths[], embeddingModel):
	delete from embeddings where path in (...) and model=...

clearAllVectors(embeddingModel):
	delete from embeddings where model=...

insertVectors(rows[]):
	insert into embeddings values rows
```

유사도 검색(`performSimilaritySearch`) 핵심:

```ts
performSimilaritySearch(queryVector, embeddingModel, {minSimilarity, limit, scope?}):
	dim = embeddingModel.dimension
	// dim이 큰 모델은 halfvec 캐스팅 경로 사용(인덱스/성능)
	embeddingExpr = (dim > 2000) ? (embedding::halfvec(dim)) : (embedding::vector(dim))
	similarity = 1 - cosineDistance(embeddingExpr, queryVector)

	scopeCondition = OR(
		path IN scope.files,
		path LIKE `${folder}/%` for folder in scope.folders
	)

	select columns(except embedding), similarity
	from embeddings
	where similarity > minSimilarity
		and model = embeddingModel.id
		and dimension = embeddingModel.dimension  // partial index fully 활용
		and (scopeCondition if provided)
	order by similarity desc
	limit limit
```

---

## 9) MCP(Model Context Protocol) 구조

### 9.1 핵심 클래스: `src/core/mcp/mcpManager.ts`

역할:
- (데스크탑에서만) MCP 서버들을 stdio transport로 연결
- 서버별 tool 목록을 가져와서 “모델에게 제공할 tools 리스트”로 변환
- tool 이름을 `serverName__toolName` 형태로 네임스페이싱
- 도구 실행 허용(자동 실행/대화별 허용) 정책 관리
- tool call 실행/중단(abort)

수도코드(초기화):

```ts
async initialize() {
	if (Platform.isMobile) disabled

	defaultEnv = shellEnvSync()
	servers = await Promise.all(settings.mcp.servers.map(connectServer))
	updateServers(servers)
}

async connectServer(serverConfig) {
	if !enabled: return Disconnected
	validateServerName(serverConfig.id)

	client = new MCP Client({name, version:'1.0.0'})
	client.connect(new StdioClientTransport({ ...params, env: defaultEnv + params.env }))
	tools = client.listTools()
	return {status:Connected, client, tools}
}
```

수도코드(tool 목록 제공):

```ts
async listAvailableTools() {
	if cached: return
	available = servers
		.filter(Connected)
		.flatMap(server => server.client.listTools())
		.filter(tool => !server.config.toolOptions[tool.name]?.disabled)
		.map(tool => ({...tool, name: `${serverName}__${tool.name}`}))
	cache = available
	return available
}
```

수도코드(tool 실행):

```ts
async callTool({name, args, id, signal}) {
	toolAbortController = new AbortController()
	activeToolCalls[id] = toolAbortController
	compositeSignal = combine(toolAbortController.signal, signal)

	{serverName, toolName} = parseToolName(name)
	server = servers.find(serverName)
	result = server.client.callTool({name: toolName, arguments: parsedArgs}, {signal: compositeSignal})

	if result.isError: return {status:'Error', error: text}
	else return {status:'Success', data:{type:'text', text}}

	catch AbortError => {status:'Aborted'}
	finally delete activeToolCalls[id]
}
```

---

## 10) Apply(Edit 적용) 구조

### 10.1 사용자 관점

- 채팅 응답 내 `<smtcmp_block>...</smtcmp_block>` 같은 “적용 블록”을 선택
- Apply 실행 → 현재 활성 파일의 원본/수정본 diff를 ApplyView에서 보여주고 적용

### 10.2 구현 포인트

- 적용은 별도의 “apply 모델”(settings.applyModelId)을 사용
- `applyChangesToFile()`은 다음을 모델에 제공:
	1) 대상 파일 전체
	2) 최근 대화 히스토리(일부)
	3) 이번에 적용해야 할 단일 블록
- 모델에게 **“지정된 블록만 반영하고 전체 파일을 다시 출력”**하라고 강하게 지시

수도코드: `src/utils/chat/apply.ts`

```ts
systemPrompt = "... 지정된 <smtcmp_block>만 적용 ... 전체 파일만 출력 ..."

generateApplyPrompt(blockToApply, currentFile, currentFileContent, chatMessages) {
	return `Target File: \n\n${currentFileContent}\n\nConversation History: ...\n\nChanges to Apply: <smtcmp_block>${blockToApply}</smtcmp_block>`
}

async applyChangesToFile({blockToApply, currentFile, currentFileContent, chatMessages, providerClient, model}) {
	requestMessages = [
		{role:'system', content: systemPrompt},
		{role:'user', content: generateApplyPrompt(...)}
	]
	response = await providerClient.generateResponse(model, {stream:false, messages:requestMessages, prediction:{...}})
	return extractApplyResponseContent(response.choices[0].message.content)
}
```

Chat에서 ApplyView 열기: `src/components/chat-view/Chat.tsx`

```ts
applyMutation() {
	activeFile = app.workspace.getActiveFile(); assert exists
	activeFileContent = readTFileContent(activeFile)

	{providerClient, model} = getChatModelClient(settings.applyModelId)
	updatedFileContent = applyChangesToFile(...)

	workspace.getLeaf(true).setViewState({
		type: APPLY_VIEW_TYPE,
		state: { file: activeFile, originalContent: activeFileContent, newContent: updatedFileContent }
	})
}
```

---

## 11) 데이터/스토리지 계층

### 11.1 PGlite + Drizzle (벡터/레거시 템플릿)

#### DatabaseManager: `src/database/DatabaseManager.ts`

역할:
- `.smtcmp_vector_db.tar.gz` 경로에 PGlite DB를 dump/restore
- PGlite 자산(`pglite/postgres.wasm` 등)을 Obsidian resource URL로 fetch
- Drizzle migrations (`src/database/migrations.json`) 실행
- `VectorManager`, `LegacyTemplateManager`를 생성하고 save/vacuum 콜백 연결

수도코드:

```ts
static async create(app, plugin) {
	db = await loadExistingDatabase() || await createNewDatabase()
	migrateDatabase() // drizzle migrations.json
	save()            // dumpDataDir('gzip') -> writeBinary

	vectorManager = new VectorManager(app, db)
	templateManager = new LegacyTemplateManager(app, db)
	vectorManager.setSaveCallback(save)
	vectorManager.setVacuumCallback(vacuum)
	templateManager.setSaveCallback(save)
	templateManager.setVacuumCallback(vacuum)

	return dbManager
}
```

#### 스키마: `src/database/schema.ts`

- `embeddings` 테이블
	- `path`, `mtime`, `content`, `model`, `dimension`, `embedding(vector)`, `metadata(jsonb)`
	- 차원별 HNSW 인덱스를 dimension 조건(where)로 분기 생성
- `template` 테이블(레거시)
	- `name`, `content(jsonb)`, timestamps

레거시 템플릿 CRUD는 Drizzle 레포지토리로도 분리되어 있음:
- `src/database/modules/template/TemplateRepository.ts`

```ts
create(template): insert into template returning row
findAll(): select * from template
findByName(name): select * from template where name=...
update(id, partial): update template set ..., updatedAt=now returning row
delete(id): delete from template where id=... returning row
```

주의: 현재 사용자-facing 템플릿 관리는 주로 JSON DB(`src/database/json/template/TemplateManager.ts`)를 사용하며,
위 레거시 테이블/레포지토리는 “마이그레이션/과거 데이터 호환” 맥락이 섞여 있습니다.

### 11.2 JSON DB (채팅/신규 템플릿)

폴더: `src/database/json/`

- `base.ts` : `AbstractJsonRepository`
	- Vault 내부 폴더에 `.json` 파일을 CRUD
	- list는 “파일명 파싱” 기반 메타데이터 추출

- `constants.ts`
	- 루트: `.smtcmp_json_db/`
	- 하위: `chats/`, `templates/`, 마이그레이션 마커 파일

- `chat/ChatManager.ts`
	- 파일명 규칙: `v{schemaVersion}_{title}_{updatedAt}_{id}.json`
	- listChats: updatedAt desc

- `template/TemplateManager.ts`
	- 파일명 규칙: `v{schemaVersion}_{name}_{id}.json`
	- fuzzysort로 템플릿 검색

### 11.3 레거시 → JSON 마이그레이션

`src/database/json/migrateToJsonDatabase.ts`:

```ts
if marker exists: return

transferChatHistoryFromLegacy() {
	old = utils/chat/chatHistoryManager 기반
	new = json/chat/ChatManager
	for each old chat:
		if new already has id: continue
		new.createChat({id,title,messages,createdAt,updatedAt})
		old.deleteChatConversation(id)
}

transferTemplatesFromDrizzle() {
	drizzleTemplateManager = dbManager.getTemplateManager()
	jsonTemplateManager = new json/template/TemplateManager
	for each drizzle template:
		if json already has name: continue
		json.createTemplate({name, content})
		drizzle.deleteTemplate(id)
}

write marker file
reload ChatView
```

---

## 12) 설정(Settings) 구조

### 12.1 스키마/파싱

- `src/settings/schema/setting.types.ts`
	- zod 기반 `smartComposerSettingsSchema`
	- providers/chatModels/embeddingModels 및 옵션들

- `src/settings/schema/settings.ts`
	- `parseSmartComposerSettings(data)`
		- settings 마이그레이션 실행
		- 실패 시 defaults

설정 핵심 필드(요약):

```ts
settings = {
	version,
	providers: [...],
	chatModels: [...],
	embeddingModels: [...],
	chatModelId,
	applyModelId,
	embeddingModelId,
	systemPrompt,
	ragOptions: { chunkSize, thresholdTokens, minSimilarity, limit, excludePatterns, includePatterns },
	mcp: { servers: [...] },
	chatOptions: { includeCurrentFileContent, enableTools, maxAutoIterations }
}
```

### 12.2 UI

- `src/settings/SettingTab.tsx`
	- Obsidian `PluginSettingTab` + React `SettingsTabRoot` 렌더
	- `SettingsProvider`로 settings state 주입

### 12.3 Settings React 섹션별 동작(중요)

Settings UI는 “settings 객체를 직접 편집”하는 방식이며, 기본값(defaults)과 동일한 id를 가진 항목은 일부 동작에서 보호됩니다.

#### 12.3.1 Providers 섹션

파일: `src/components/settings/sections/ProvidersSection.tsx`

- 테이블: `settings.providers` 목록
- provider.type은 `PROVIDER_TYPES_INFO[provider.type].label`로 사람이 읽는 라벨을 결정
- 기본 provider(`DEFAULT_PROVIDERS`에 포함)는 삭제 버튼이 안 뜸
- provider 편집은 `EditProviderModal`로 이동(보통 API Key/Base URL/Additional settings 수정)

삭제(핵심 부작용 포함) 수도코드:

```ts
async handleDeleteProvider(provider) {
	associatedChatModels = settings.chatModels.filter(m => m.providerId === provider.id)
	associatedEmbeddingModels = settings.embeddingModels.filter(m => m.providerId === provider.id)

	confirm("delete provider + delete its models + clear embeddings")
		onConfirm: async () => {
			vectorManager = (await plugin.getDbManager()).getVectorManager()
			embeddingStats = await vectorManager.getEmbeddingStats()

			for each embeddingModel in associatedEmbeddingModels:
				if embeddingStats has rows for embeddingModel.id:
					embeddingModelClient = getEmbeddingModelClient({settings, embeddingModelId: embeddingModel.id})
					await vectorManager.clearAllVectors(embeddingModelClient)

			await setSettings({
				...settings,
				providers: settings.providers.filter(p => p.id !== provider.id),
				chatModels: settings.chatModels.filter(m => m.providerId !== provider.id),
				embeddingModels: settings.embeddingModels.filter(m => m.providerId !== provider.id),
			})
		}
}
```

즉, provider를 지우면:
- 그 provider에 매핑된 chat/embedding model도 같이 제거되고
- embedding model이 생성한 벡터 임베딩(로컬 DB)도 삭제될 수 있습니다.

#### 12.3.2 Models 섹션

파일: `src/components/settings/sections/ModelsSection.tsx`

하위 2개 섹션으로 분리:

1) Chat Models
- 파일: `src/components/settings/sections/models/ChatModelsSubSection.tsx`
- 테이블: `settings.chatModels`
- Enable 토글:
	- 기본값: `enable ?? true`
	- 단, 현재 선택된 `settings.chatModelId` 또는 `settings.applyModelId`인 모델은 disable 불가(Notice)
- 삭제:
	- 현재 선택된 chat/apply 모델이면 삭제 불가(Notice)
	- `DEFAULT_CHAT_MODELS`에 포함된 모델은 삭제 버튼이 안 뜸
- “추가 설정” 버튼:
	- `hasChatModelSettings(chatModel)`인 경우 `ChatModelSettingsModal` 오픈
	- providerType에 따라 reasoning/thinking/web_search_options 같은 추가 옵션을 다루는 곳

2) Embedding Models
- 파일: `src/components/settings/sections/models/EmbeddingModelsSubSection.tsx`
- 테이블: `settings.embeddingModels`
- 삭제:
	- 현재 선택된 `settings.embeddingModelId`면 삭제 불가(Notice)
	- 삭제 시 해당 embeddingModel이 만든 벡터 임베딩을 로컬 DB에서 삭제(데이터가 있을 때만)
	- `DEFAULT_EMBEDDING_MODELS`에 포함된 모델은 삭제 버튼이 안 뜸

```ts
async handleDeleteEmbeddingModel(modelId) {
	if modelId === settings.embeddingModelId: block
	confirm("delete model + clear embeddings")
		onConfirm: async () => {
			vectorManager = (await plugin.getDbManager()).getVectorManager()
			if vectors exist for modelId:
				embeddingClient = getEmbeddingModelClient({settings, embeddingModelId:modelId})
				await vectorManager.clearAllVectors(embeddingClient)
			setSettings({ ...settings, embeddingModels: settings.embeddingModels.filter(m => m.id !== modelId) })
		}
}
```

#### 12.3.3 Chat 섹션

파일: `src/components/settings/sections/ChatSection.tsx`

- Chat model dropdown:
	- 후보: `settings.chatModels.filter(enable ?? true)`
	- 선택: `settings.chatModelId`
	- Recommended 표시는 `RECOMMENDED_MODELS_FOR_CHAT` 기반

- Apply model dropdown:
	- 후보: `settings.chatModels.filter(enable ?? true)`
	- 선택: `settings.applyModelId`
	- Recommended 표시는 `RECOMMENDED_MODELS_FOR_APPLY` 기반

- System prompt:
	- `settings.systemPrompt` (매 요청의 시스템 메시지 앞부분에 포함)

- Include current file:
	- `settings.chatOptions.includeCurrentFileContent`

- Enable tools:
	- `settings.chatOptions.enableTools`
	- true일 때 MCP tool-call 실행/승인 UI가 활성화되는 방향으로 동작

- Max auto tool requests:
	- `settings.chatOptions.maxAutoIterations`
	- “연속 tool-call 자동 실행” 허용 횟수(비용 상승 경고 포함)

#### 12.3.4 MCP 섹션

파일: `src/components/settings/sections/McpSection.tsx`

- 플러그인의 `plugin.getMcpManager()`를 통해 MCP 서버 목록을 구독/표시
- 모바일에서는 MCP 비활성(`mcpManager.disabled`) 안내 표시
- 서버별:
	- enabled 토글(`settings.mcp.servers[].enabled`)과 상태(Connected/Connecting/Error/Disconnected) 표시
	- 확장 영역에서 tool 목록을 보여주고, tool별:
		- Enabled(=disabled 반전 저장)
		- Auto-execute(자동 실행 허용)

저장 형태(개념):

```ts
settings.mcp.servers[] = {
	id: serverName,
	enabled,
	// ... command/env/etc
	toolOptions: {
		[toolName]: { disabled: boolean, allowAutoExecution: boolean }
	}
}
```

### 12.4 Settings 마이그레이션(스키마 버전) 작성 레시피

Settings는 zod schema로 파싱되기 전에 “버전 기반 마이그레이션”을 먼저 수행합니다.

- 버전/마이그레이션 등록: `src/settings/schema/migrations/index.ts`
	- `SETTINGS_SCHEMA_VERSION` 상수
	- `SETTING_MIGRATIONS` 배열(from/to/migrate)

- 파싱 엔트리: `src/settings/schema/settings.ts`
	- `migrateSettings()`가 `SETTING_MIGRATIONS`를 순회
	- 각 migration은 `currentVersion < toVersion` 조건일 때 순차 적용
	- 마지막에 `smartComposerSettingsSchema.parse()`
	- 실패 시 defaults로 fallback

마이그레이션 추가 절차(체크리스트):

```text
1) 새 버전 N+1 결정
2) src/settings/schema/migrations/N_to_{N+1}.ts 추가
3) index.ts에서 migrateFromNTo{N+1} import + SETTING_MIGRATIONS에 push
4) index.ts에서 SETTINGS_SCHEMA_VERSION = N+1 로 bump
5) 필요하면 테스트 파일 N_to_{N+1}.test.ts 추가/수정
```

“기본 providers/models(defaults)”를 바꿀 때 특히 중요:
- `src/constants.ts`의 `DEFAULT_PROVIDERS`, `DEFAULT_CHAT_MODELS`, `DEFAULT_EMBEDDING_MODELS`를 변경하면
	- 기존 사용자 설정에도 반영되도록 migration을 추가해야 합니다.
- migration은 `migrationUtils.ts`의 `getMigratedProviders/getMigratedChatModels` 패턴을 주로 사용합니다.
	- 동작: 기본 목록을 먼저 만들고, 동일 id가 있으면 existing 객체에 default를 `Object.assign(existing, default)`로 덮어씀
	- 결과: 같은 id를 쓰는 기존 사용자 설정은 기본값에 의해 덮어써질 수 있음(특히 nested object는 shallow merge)

주의(코드에 FIXME로 명시됨):
- `Object.assign`은 shallow merge라서 `reasoning/thinking/web_search_options` 같은 중첩 옵션이
	"유저 설정"이 아니라 "default"로 통째로 덮일 수 있습니다.

---

## 13) LLM Provider 레이어(`src/core/llm/`)

구성 방식:

- `base.ts` : Provider 공통 인터페이스
	- `generateResponse()` (non-stream)
	- `streamResponse()` (stream)
	- `getEmbedding()`

- `manager.ts`
	- `getProviderClient(settings, providerId)`
	- `getChatModelClient(settings, modelId)`
		- modelId로 chatModels에서 모델 찾고
		- 그 모델의 providerId로 provider client를 생성

- provider 파일들(openai/anthropic/gemini/ollama/…)
	- 각 SDK 호출을 `BaseLLMProvider` 형태로 래핑

### 13.1 모델/프로바이더 해석(Resolution) 흐름

핵심: settings에는 “provider 인스턴스”와 “model 정의”가 분리되어 저장됩니다.

- provider 인스턴스: `settings.providers[]`
	- `{ id, type, apiKey?, baseUrl?, additionalSettings? }`
	- `type`은 zod discriminated union(`src/types/provider.types.ts`)으로 고정된 enum-like 값

- chat model 정의: `settings.chatModels[]`
	- `{ id, providerId, providerType, model, (옵션...) }`
	- 여기서 `providerId`가 실제로 어떤 provider 인스턴스를 사용할지를 결정
	- `providerType`은 UI/validation 및 provider별 추가 옵션(reasoning/thinking/...)을 구분하기 위한 discriminant

- embedding model 정의: `settings.embeddingModels[]`
	- `{ id, providerId, providerType, model, dimension }`
	- `dimension`은 vector DB 스키마/인덱스/검색에서 매우 중요(차원별 halfvec/vector 처리)

런타임에서의 선택/생성:

```ts
// chat
function getChatModelClient({settings, modelId}) {
	chatModel = settings.chatModels.find(m => m.id === modelId)
	providerClient = getProviderClient({settings, providerId: chatModel.providerId})
	return { providerClient, model: chatModel }
}

// embedding
function getEmbeddingModelClient({settings, embeddingModelId}) {
	embeddingModel = settings.embeddingModels.find(m => m.id === embeddingModelId)
	providerClient = getProviderClient({settings, providerId: embeddingModel.providerId})
	return {
		id: embeddingModel.id,
		dimension: embeddingModel.dimension,
		getEmbedding: (text) => providerClient.getEmbedding(embeddingModel.model, text),
	}
}
```

### 13.2 새 Provider Type 추가 레시피(실전 체크리스트)

"provider type"은 런타임 switch와 zod discriminated union에 동시에 걸려있어서, 추가 시 빠뜨릴 부분이 많습니다.

1) Provider 타입(zod) 추가
- `src/types/provider.types.ts`
	- `llmProviderSchema = z.discriminatedUnion('type', [...])`에 새 `type` literal 추가
	- baseUrl/apiKey/additionalSettings가 필요한지에 따라 schema를 설계
	- 주석으로도 명시: provider 추가 시 함께 업데이트할 파일 목록이 있음

2) Provider 메타데이터(설정 UI 요구사항) 추가
- `src/constants.ts`
	- `PROVIDER_TYPES_INFO[providerType]` 추가
		- label
		- defaultProviderId (기본 provider로 넣을지 여부)
		- requireApiKey / requireBaseUrl
		- supportEmbedding
		- additionalSettings(Setting UI에서 렌더되는 추가 입력)

3) Provider 구현체 작성
- `src/core/llm/`에 `XxxProvider` 추가
	- `BaseLLMProvider<LLMProviderSubtype>` 상속
	- `generateResponse`, `streamResponse`, `getEmbedding` 구현
	- embedding 미지원 provider라면 `getEmbedding`에서 명확히 예외 처리(또는 settings/UI에서 embedding 모델 생성을 막기)

4) Provider 선택 switch 연결
- `src/core/llm/manager.ts`
	- `getProviderClient()`의 `switch(provider.type)`에 새 케이스 추가

5) Model 타입(zod) 연결
- `src/types/chat-model.types.ts`
	- `chatModelSchema`의 `providerType` union에 새 providerType 추가
	- (필요 시) provider 전용 옵션 필드 추가(예: reasoning/thinking/web_search_options)

- `src/types/embedding-model.types.ts`
	- `embeddingModelSchema`의 `providerType` union에 새 providerType 추가
	- 단, 실제 embedding 지원 여부는 `PROVIDER_TYPES_INFO[providerType].supportEmbedding` 및 provider 구현에 의해 결정

### 13.3 새 Default Provider/Model 추가 레시피(버전 호환)

기본값은 `smartComposerSettingsSchema`의 `.catch([...DEFAULT_...])`로 들어가지만,
이미 settings를 가진 기존 사용자는 “마이그레이션”이 없으면 자동으로 새 기본값을 못 받습니다.

추가 절차:

```text
1) src/constants.ts
	- DEFAULT_PROVIDERS / DEFAULT_CHAT_MODELS / DEFAULT_EMBEDDING_MODELS에 항목 추가
	- (필요 시) DEFAULT_CHAT_MODEL_ID, DEFAULT_APPLY_MODEL_ID, RECOMMENDED_* 업데이트

2) src/settings/schema/migrations
	- version bump + N_to_{N+1} migration 추가
	- migration에서 getMigratedProviders/getMigratedChatModels 같은 패턴으로
	  "새 default 포함" 리스트를 적용

3) migration 테스트 갱신(해당 폴더의 *.test.ts)
```

주의:
- `DEFAULT_*`에 포함된 항목은 Settings UI에서 삭제 버튼이 숨겨져 “보호”됩니다.
- migrationUtils가 현재 shallow merge(Object.assign)라서, 같은 id의 사용자 설정과 충돌 시
	중첩 옵션이 통째로 default로 덮일 수 있습니다(코드 FIXME 참고).

### 13.4 새 Chat Model / Embedding Model 추가 레시피

두 가지 경로가 있습니다:

1) 사용자 설정(UI)에서 “Custom model”로 추가
- chat: `AddChatModelModal`
- embedding: `AddEmbeddingModelModal`

2) 앱 기본값(DEFAULT_*)으로 추가(배포 시 포함)
- `src/constants.ts`에 `DEFAULT_CHAT_MODELS` 또는 `DEFAULT_EMBEDDING_MODELS`를 수정
- 반드시 settings migration을 함께 추가(13.3 참고)

모델 항목에서 중요한 필드:

```ts
// chatModels[]
{
	id: "사람이 구분하는 ID"              // settings.chatModelId/applyModelId에서 참조
	providerId: "settings.providers[].id"   // 어떤 provider 인스턴스를 쓸지
	providerType: "openai|anthropic|..."   // zod discriminated union
	model: "SDK에 넘기는 실제 모델명"
	// optional: enable, promptLevel, reasoning/thinking/web_search_options ...
}

// embeddingModels[]
{
	id,
	providerId,
	providerType,
	model,
	dimension,
}
```

삭제/변경의 부작용:
- embedding model 삭제 시 해당 model로 생성된 벡터 임베딩이 로컬 DB에서 삭제될 수 있음
- provider 삭제 시 연결된 모델/임베딩까지 같이 삭제될 수 있음

### 13.5 스트리밍 usage/호환성 메모(요약)

`src/core/llm/manager.ts` 상단 코멘트 기준 요약:
- OpenAI/OpenAI-compatible/Anthropic: 스트림 마지막 chunk에 usage를 포함하는 동작을 따름
- Groq/Ollama: 현재 streaming usage 통계를 지원하지 않음

수도코드:

```ts
providerClient = getProviderClient({settings, providerId})
chatClient = getChatModelClient({settings, modelId})

// stream
for await (chunk of providerClient.streamResponse(model, request)) {
	append content/reasoning
	merge tool_call deltas
	update annotations/usage
}
```

---

## 14) 컨텍스트/훅/유틸

### 14.1 contexts/

- settings-context: settings 캐시 + plugin의 change listener로 동기화
- database-context: `getDatabaseManager/getVectorManager/getTemplateManager`
- rag-context: `getRAGEngine()`
- mcp-context: `getMcpManager()`
- plugin-context/app-context: Obsidian Plugin/App 핸들 주입

### 14.2 hooks/

- `useChatHistory.ts`
	- JSON ChatManager로 대화 저장/로드
	- createOrUpdate는 debounce(300ms)로 잦은 저장 완화

- `useJsonManagers.ts`
	- ChatManager/TemplateManager를 memoize

### 14.3 utils/chat/

- `responseGenerator.ts`: 스트리밍 + tool_call 수집 + MCP 실행
- `promptGenerator.ts`: mentionables/URL/이미지/YT + RAG 포함 prompt 합성
- `apply.ts`: apply 전용 시스템 프롬프트 + 파일 재작성
- `parse-tag-content.ts`: `<smtcmp_block>`, `<think>` 태그 파서

---

## 15) (참고) 문서 작성 기준

- 이 문서는 “코드 위치와 흐름”을 이해하기 위한 내부 메모입니다.
- UI 세부 컴포넌트(각 메시지 렌더링/입력 플러그인 등)는 `src/components/chat-view/`에 다수 존재하며,
	여기서는 **핵심 데이터 흐름과 책임 분리**에 초점을 맞췄습니다.

