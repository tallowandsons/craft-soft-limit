// Soft Limit Plugin JavaScript
// Provides utility functions for character counting in rich text editors

window.SoftLimit = class SoftLimit {
    constructor(inputId, options) {
        this.inputId = inputId;
        this.limit = options.limit;
        this.isRichText = options.isRichText;

        // Find the input element
        this.input =
            document.getElementById(inputId) ||
            document.querySelector("#" + inputId) ||
            document.querySelector(
                '[name*="' + inputId.replace(/^.*-/, "") + '"]'
            );

        this.counter = document.querySelector(
            '.soft-limit-counter[data-input="' + inputId + '"]'
        );

        if (!this.input || !this.counter) {
            return;
        }

        this.init();
    }

    init() {
        this.updateCounter();

        if (this.isRichText) {
            this.initRichTextHandlers();
        } else {
            this.input.addEventListener("input", () => this.updateCounter());
            this.input.addEventListener("keyup", () => this.updateCounter());
            this.input.addEventListener("paste", () =>
                setTimeout(() => this.updateCounter(), 10)
            );
        }
    }

    initRichTextHandlers() {
        // Handle Redactor
        if (
            typeof $ !== "undefined" &&
            this.input.classList.contains("redactor")
        ) {
            const redactorInstance = $(this.input).data("redactor");
            if (redactorInstance) {
                redactorInstance.core.editor().on("keyup input", () => {
                    setTimeout(() => this.updateCounter(), 10);
                });
            }
        }

        // Handle CKEditor
        if (typeof CKEDITOR !== "undefined") {
            const editorInstance = CKEDITOR.instances[this.inputId];
            if (editorInstance) {
                editorInstance.on("key", () => {
                    setTimeout(() => this.updateCounter(), 10);
                });
                editorInstance.on("change", () => this.updateCounter());
            }
        }

        // Fallback for other rich text editors
        this.input.addEventListener("input", () => this.updateCounter());
        this.input.addEventListener("keyup", () => this.updateCounter());
        this.input.addEventListener("paste", () =>
            setTimeout(() => this.updateCounter(), 50)
        );
    }

    getTextContent() {
        if (this.isRichText) {
            let content = this.input.value || "";

            // Handle Redactor
            if (
                typeof $ !== "undefined" &&
                this.input.classList.contains("redactor")
            ) {
                const redactorInstance = $(this.input).data("redactor");
                if (redactorInstance) {
                    content = redactorInstance.code.get();
                }
            }

            // Handle CKEditor
            if (typeof CKEDITOR !== "undefined") {
                const editorInstance = CKEDITOR.instances[this.inputId];
                if (editorInstance) {
                    content = editorInstance.getData();
                }
            }

            // Strip HTML tags and decode entities
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = content;
            return (tempDiv.textContent || tempDiv.innerText || "").trim();
        } else {
            return this.input.value || "";
        }
    }

    updateCounter() {
        const content = this.getTextContent();
        const currentLength = content.length;

        this.counter.textContent = `${currentLength}/${this.limit}`;

        // Update CSS classes based on limit status
        this.counter.classList.remove(
            "soft-limit-warning",
            "soft-limit-exceeded"
        );

        if (currentLength > this.limit) {
            this.counter.classList.add("soft-limit-exceeded");
        } else if (currentLength > this.limit * 0.8) {
            this.counter.classList.add("soft-limit-warning");
        }
    }
};
