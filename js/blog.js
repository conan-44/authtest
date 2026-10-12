(() => {
    const BLOG_INDEX_URL = "./data/blog/index.skvwmeta";
    const blogPosts = document.getElementById("blogPosts");
    let blogLoaded = false;

    function escapeHTML(value) {
        return value.replace(/[&<>'"]/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "'": "&#39;",
            '"': "&quot;"
        })[character]);
    }

    function renderInlineMarkdown(text) {
        const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
        return parts.map(part => {
            const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            if (link) {
                let url;
                try {
                    url = new URL(link[2], window.location.href);
                } catch (error) {
                    return escapeHTML(link[1]);
                }
                if (!["http:", "https:", "mailto:"].includes(url.protocol)) return escapeHTML(link[1]);
                const href = escapeHTML(link[2]);
                return `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHTML(link[1])}</a>`;
            }

            return escapeHTML(part)
                .replace(/`([^`]+)`/g, "<code>$1</code>")
                .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                .replace(/__([^_]+)__/g, "<strong>$1</strong>")
                .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
                .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
        }).join("");
    }

    function markdownToHTML(markdown) {
        const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
        const output = [];
        let paragraph = [];
        let listType = null;
        let codeLines = null;

        const flushParagraph = () => {
            if (paragraph.length) {
                output.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
                paragraph = [];
            }
        };
        const closeList = () => {
            if (listType) {
                output.push(`</${listType}>`);
                listType = null;
            }
        };

        lines.forEach(line => {
            if (codeLines) {
                if (/^\s*```/.test(line)) {
                    output.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
                    codeLines = null;
                } else {
                    codeLines.push(line);
                }
                return;
            }

            if (/^\s*```/.test(line)) {
                flushParagraph();
                closeList();
                codeLines = [];
                return;
            }
            if (!line.trim()) {
                flushParagraph();
                closeList();
                return;
            }

            const heading = line.match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                flushParagraph();
                closeList();
                const level = heading[1].length;
                const highlightedHeading = heading[2].startsWith("++");
                const text = highlightedHeading ? heading[2].slice(2).trim() : heading[2];
                const className = highlightedHeading ? ' class="blog-highlight-heading"' : "";
                output.push(`<h${level}${className}>${renderInlineMarkdown(text)}</h${level}>`);
                return;
            }

            const item = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
            if (item) {
                flushParagraph();
                const nextListType = /^\d/.test(item[1]) ? "ol" : "ul";
                if (listType !== nextListType) {
                    closeList();
                    output.push(`<${nextListType}>`);
                    listType = nextListType;
                }
                output.push(`<li>${renderInlineMarkdown(item[2])}</li>`);
                return;
            }

            const quote = line.match(/^\s*>\s?(.*)$/);
            if (quote) {
                flushParagraph();
                closeList();
                output.push(`<blockquote><p>${renderInlineMarkdown(quote[1])}</p></blockquote>`);
                return;
            }

            closeList();
            paragraph.push(line);
        });

        flushParagraph();
        closeList();
        if (codeLines) output.push(`<pre><code>${escapeHTML(codeLines.join("\n"))}</code></pre>`);
        return output.join("");
    }

    function normalizePostEntry(entry) {
        const post = typeof entry === "string" ? { id: entry } : entry;
        if (!post || typeof post !== "object") throw new Error("Blog index entries must be IDs or objects.");
        const fileName = typeof post.id === "string" ? post.id : typeof post.file === "string" ? post.file : "";
        const id = fileName.replace(/\.siumingboke$/i, "");
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error(`Invalid blog post ID: ${id || "(empty)"}`);
        return {
            id,
            fileName,
            title: typeof post.title === "string" && post.title.trim() ? post.title.trim() : "",
            date: typeof post.date === "string" ? post.date : ""
        };
    }

    function renderPost(post, markdown) {
        const article = document.createElement("article");
        article.className = "blog-post";
        const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
        const headingIndex = lines.findIndex(line => /^#\s+/.test(line));
        const title = post.title || (headingIndex >= 0 ? lines[headingIndex].replace(/^#\s+/, "").trim() : post.id.replace(/[-_]+/g, " "));
        if (headingIndex >= 0) lines.splice(headingIndex, 1);

        const header = document.createElement("header");
        const heading = document.createElement("h2");
        heading.textContent = title;
        header.appendChild(heading);
        if (post.date) {
            const date = document.createElement("time");
            date.dateTime = post.date;
            date.textContent = post.date;
            header.appendChild(date);
        }
        const content = document.createElement("div");
        content.className = "blog-prose";
        content.innerHTML = markdownToHTML(lines.join("\n"));
        article.append(header, content);
        return article;
    }

    async function loadBlog() {
        if (blogLoaded) return;
        blogLoaded = true;
        blogPosts.replaceChildren();
        try {
            const response = await fetch(BLOG_INDEX_URL, { cache: "no-store" });
            if (!response.ok) throw new Error(`Could not load ${BLOG_INDEX_URL} (${response.status}).`);
            const entries = window.AchievementLib.parseJsonWithComments(await response.text());
            if (!Array.isArray(entries)) throw new Error("Blog index must contain an array of post entries.");
            if (!entries.length) {
                const emptyMessage = document.createElement("p");
                emptyMessage.className = "blog-status";
                emptyMessage.textContent = "No blog posts yet.";
                blogPosts.appendChild(emptyMessage);
                return;
            }

            for (const entry of entries) {
                try {
                    const post = normalizePostEntry(entry);
                    const fileNames = post.fileName.endsWith(".siumingboke")
                        ? [post.fileName]
                        : [`${post.id}.siumingboke`, post.fileName];
                    let postResponse = null;
                    for (const fileName of fileNames) {
                        try {
                            const response = await fetch(`./data/blog/${encodeURIComponent(fileName)}`, { cache: "no-store" });
                            if (response.ok) {
                                postResponse = response;
                                break;
                            }
                        } catch (error) {
                            console.info(`Blog post file "${fileName}" was not found.`);
                        }
                    }
                    if (!postResponse) throw new Error(`Could not load blog post "${post.id}".`);
                    blogPosts.appendChild(renderPost(post, await postResponse.text()));
                } catch (error) {
                    console.error("Could not load a blog post.", error);
                    const postError = document.createElement("p");
                    postError.className = "blog-status blog-error";
                    postError.textContent = error.message;
                    blogPosts.appendChild(postError);
                }
            }
        } catch (error) {
            console.error("Could not load blog index.", error);
            const errorMessage = document.createElement("p");
            errorMessage.className = "blog-status blog-error";
            errorMessage.textContent = error.message;
            blogPosts.appendChild(errorMessage);
        }
    }

    window.initBlogTab = loadBlog;
})();
