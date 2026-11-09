<h1 align="center">Smart Composer</h1>

<p align="center">
  <a href="https://github.com/glowingjade/obsidian-smart-composer/wiki">Documentation</a>
</p>

> [!NOTE]
> **What's New**
>
> **📄 Document OCR** — Convert PDFs to Markdown with Mistral OCR from the file menu or command palette
> 
> **🔑 Keychain Storage** — API keys and subscription tokens are stored in Obsidian Keychain
> 
> **🔍 Embeddings** — Voyage AI embedding models, and faster vault search with embeddings stored in sharded files
> 
> **💻 CLI Tools** — Run CLI tools from chat with per-run approval, including an Obsidian CLI preset
> 
> **v1.2.8** — Connect your Gemini account
> 
> **v1.2.7** — Connect your Claude or OpenAI account directly (no API key required)
> 
> **v1.2.6** — Support for GPT-5.2, Opus 4.5, Gemini 3, and Grok 4.1
> 
> **🔌 MCP Support** — Connect Smart Composer to external tools and data sources via the [Model Context Protocol](https://modelcontextprotocol.io)

> ### Risks of connecting a Claude subscription
> 
> As of January 2026, Anthropic has restricted third-party OAuth access, citing Terms of Service violations.
> 
> Smart Composer's subscription connect uses the same OAuth-style flow that tools like OpenCode have used. There are reports of **Claude accounts being banned or restricted** when subscription OAuth is used via third-party clients (example: [https://github.com/anomalyco/opencode/issues/6930](https://github.com/anomalyco/opencode/issues/6930)). For **OpenAI (ChatGPT)** and **Google (Gemini)**, I have not seen comparable ban reports so far, but this is still not the same as official API access, and enforcement can change at any time.
> 
> **Use at your own risk.** Keep usage limited to personal, interactive sessions and avoid any automation.

![SC1_Title.gif](https://github.com/user-attachments/assets/a50a1f80-39ff-4eba-8090-e3d75e7be98c)

Everytime we ask ChatGPT, we need to put so much context information for each query. Why spend time putting background infos that are already in your vault?

**Smart Composer is an Obsidian plugin that helps you write efficiently with AI by easily referencing your vault content.** Inspired by Cursor AI and ChatGPT Canvas, this plugin unifies your note-taking and content creation process within Obsidian.

## Credential storage

On Obsidian 1.11.5+, API keys and subscription credentials are stored in Obsidian
Keychain as `smart-composer-<provider id>`; only that reference stays in
`data.json`. When Keychain is unavailable, they are kept in `data.json`. Keychain
values do not sync with `data.json`, so other devices need the API key or
subscription sign-in again.

## Features

### Contextual Chat

![SC2_ContextChat.gif](https://github.com/user-attachments/assets/8da4c189-399a-450a-9591-95f1c9af1bc8)

Upgrade your note-taking experience with our Contextual AI Assistant, inspired by Cursor AI. Unlike typical AI plugins, our assistant allows you to **precisely select the context for your conversation.**

- Type `@<fname>` to choose specific files/folders as your conversation context
- Get responses based on selected vault content

#### Multimedia Context

<img src="https://github.com/user-attachments/assets/b22175d4-80a2-4122-8555-2b9dd4987f93" alt="SC2-2_MultiContext.png" width="360"/>

Now, you can **add website links and images** as additional context for your queries.

- Website content is automatically extracted
- **Image support**: Add images directly to your chat through:
  - Upload button
  - Drag & drop
  - Paste from clipboard
- **Youtube link support**: YouTube transcripts are fetched and included as context

### Apply Edit

![SC3_ApplyEdit.gif](https://github.com/user-attachments/assets/35ee03ff-4a61-4d08-8032-ca61fb37dcf1)

Smart Composer **suggests edits to your document.** You can apply with a single click.

- Offers document change recommendations
- Apply suggested changes instantly

### Vault Search (RAG)

![SC4_RAG-ezgif.com-crop-video.gif](https://github.com/user-attachments/assets/91c3ab8d-56d7-43b8-bb4a-1e73615a40ec)

**Automatically find and use relevant notes** from your vault to enhance AI responses.

- Hit `Cmd+Shift+Enter` to run Vault Search answer
- Semantic search across your vault to find the most relevant context

### Model Context Protocol (MCP)

![mcp_demo](https://github.com/user-attachments/assets/4c80a1af-4cbf-4aa4-90d2-457499553357)

Connect Smart Composer to external MCP servers.
MCP lets you use powerful third-party tools and data sources right inside your chat.

### Document OCR

Convert PDFs to Markdown with [Mistral OCR](https://mistral.ai/news/mistral-ocr) from the file menu or the command palette.

- The note is created next to the PDF, with images in an `assets` folder
- The original PDF is moved into the `assets` folder

### Additional Features

- **Custom Model Selection**: Use your own model by setting your API Key (stored locally). Supported API providers:
  - OpenAI
  - Anthropic
  - Google (Gemini)
  - xAI
  - DeepSeek
  - Mistral
  - Voyage AI (embeddings)
  - Perplexity
  - OpenRouter
  - Azure OpenAI
  - Ollama
  - LM Studio
  - Any other OpenAI-compatible providers
- **Local Model Support**: Run open-source LLMs and embedding models locally with [Ollama](https://ollama.ai) for complete privacy and offline usage.
- **Custom System Prompts**: Define your own system prompts that will be applied to every chat conversation.
- **Prompt Templates**: Create and reuse templates for common queries by typing `/` in the chat view. Perfect for standardizing repetitive tasks.
  - Create templates from any selected text with one click

## Getting Started

> [!IMPORTANT]
> **Installer Version Requirement**  
> Smart Composer requires a recent version of the Obsidian installer. If you experience issues with the plugin not loading properly:
> 
> 1. First, try updating Obsidian normally at `Settings > General > Check for updates`.
> 
> 2. If issues persist, manually update your Obsidian installer:
>    - Download the latest installer from [Obsidian's download page](https://obsidian.md/download)
>    - Close Obsidian completely
>    - Run the new installer

1. Open Obsidian Settings
2. Navigate to "Community plugins" and click "Browse"
3. Search for "Smart Composer" and click Install
4. Enable the plugin in Community plugins
5. Set up Smart Composer in plugin settings:
   - **Connect subscription (no API key)**: Connect your Claude/OpenAI account in `Settings > Smart Composer > Connect your subscription`
   - **API Providers (usage-based billing)**: Add an API key in `Settings > Smart Composer > Providers`
     - OpenAI: [ChatGPT API Keys](https://platform.openai.com/api-keys)
     - Anthropic: [Claude API Keys](https://console.anthropic.com/settings/keys)
     - Gemini: [Gemini API Keys](https://aistudio.google.com/apikey)

> [!TIP]
> **Looking for a free option?**  
> Gemini API provides the best performance among free models for Smart Composer. Recommended for users looking for a free option.
> _When using free APIs, please review the provider’s privacy policy before sending sensitive data._

**📚 For detailed setup instructions and documentation, please visit our [Documentation](https://github.com/glowingjade/obsidian-smart-composer/wiki).**

## Contributing

We welcome all kinds of contributions to Smart Composer, including bug reports, bug fixes, documentation improvements, and feature enhancements.

If you're interested in contributing, please refer to our [CONTRIBUTING.md](CONTRIBUTING.md) file for detailed information on:

- Setting up the development environment
- Our development workflow
- Working with the database schema
- The process for submitting pull requests
- Known issues and solutions for developers


## Contributors

### Core Team

These contributors were instrumental in shaping the initial vision, architecture, and design of Smart Composer:

**[@glowingjade](https://github.com/glowingjade)** ([Twitter](https://x.com/andy_suh_)), **[@kevin-on](https://github.com/kevin-on)**, **[@realsnoopso](https://github.com/realsnoopso)** ([Twitter](https://twitter.com/RealSnoopSo) · [LinkedIn](https://linkedin.com/in/realsnoopso)), **[@woosukji](https://github.com/woosukji)**

### Additional Contributors

We also want to thank everyone else who has contributed. Your time and effort help make Smart Composer better for everyone!

## License

This project is licensed under the [MIT License](LICENSE).
