<!-- @language Markdown  @updated 2026-08-03  @changed New page: knowledge base, file library, folders, URL ingestion. -->

# Knowledge base & files

The knowledge base is the set of documents your assistant searches to answer questions. It
cites which file each passage came from, so students can check the source.

## Supported file types

**TXT · MD · PDF · DOCX · PPTX**

Anything else is silently ignored rather than reported as an error, so if a file seems not
to have uploaded, check the extension first.

- **PowerPoint** is read one slide at a time, and citations name the slide number.
- **Scanned PDFs** are handled — pages with no text layer go through OCR automatically.
  Large scanned documents take a few minutes and show progress while they work.

## Size limits

| Where you upload | Limit |
|---|---|
| The creation wizard (step 3) | 500 MB per file, as stated on screen |
| The file library in the chat sidebar | **50 MB per file** |

> These genuinely differ. If you're uploading anything large, do it in the wizard — or
> better, keep documents under 50 MB so it never matters which route you used.

## Adding files after publishing

Open the assistant and use the **file library** in the chat sidebar. The orange **+**
button (*"Add files, folder, or link"*) gives you three options.

![The file library](/guide-media/files-panel.png)

### Add files

Same formats as above. You'll see the ingest progress as it works:

*"Preparing your file"* → *"Reading images in your PDF"* → *"Indexing extracted text"*

A file isn't usable until that finishes.

### Add folder

Name a folder and organise documents into it. Navigate with the breadcrumb at the top of
the panel — the root is **Files**.

There's also a virtual **Bot Files** folder holding one sub-folder per assistant you've
chatted with, so material attached to a specific bot stays findable.

### Add link

Paste a URL and click **Fetch & Ingest**. The page is fetched, stripped to its readable
text, and indexed exactly like an uploaded document. Useful for a news article, a working
paper, or a documentation page you want the assistant to know about.

URL-sourced items show a link icon and their source address instead of a file size.

## Choosing which files a conversation uses

Click a file row to toggle it into the current chat's context — selected rows turn orange.
Leave everything unselected and the assistant searches your whole library.

You can't select a file that's still ingesting.

## Editing the knowledge base later

**Customize → Knowledge Base Files** shows **Currently Uploaded** with a view and a delete
icon per file, and **Pending Upload** for anything you've just added. Deleting removes the
document and its indexed content.

Video Analysis Spaces have no knowledge base — they don't use one.

## Web access

Separate from uploaded files. The **"Allow web search & URL access"** toggle (Advanced
mode, chat bots) lets the assistant search the web and read URLs students paste into the
conversation.

- **On** (default) — answers can draw on the open web as well as your documents.
- **Off** — the assistant is restricted to what you uploaded.

Turn it off for a closed-book study aid; leave it on for anything current-events adjacent.

> Web access requires a **Claude** model. On Gemini or Deepseek the toggle has no effect.
