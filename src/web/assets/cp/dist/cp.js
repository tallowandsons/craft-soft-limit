/**
 * Soft Limit Plugin JavaScript
 * Handles character counting for text fields with soft limits
 */

class SoftLimitManager {
    constructor() {
        this.counters = new Map();
        this.init();
    }

    init() {
        // Initialize on DOM ready
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () =>
                this.initializeCounters()
            );
        } else {
            this.initializeCounters();
        }

        // Also initialize when new content is added (for dynamic forms)
        this.observeNewCounters();
    }

    initializeCounters() {
        const counterElements = document.querySelectorAll(
            ".soft-limit-counter"
        );
        counterElements.forEach((counterElement) => {
            if (!counterElement.dataset.initialized) {
                this.initializeCounter(counterElement);
                counterElement.dataset.initialized = "true";
            }
        });
    }

    initializeCounter(counterElement) {
        const inputId = counterElement.dataset.input;
        const limit = parseInt(counterElement.dataset.limit);
        const isRichText = counterElement.dataset.richText === "1";
        const fieldClass = counterElement.dataset.fieldClass;

        // Find the input element
        const input = this.findInputElement(inputId);
        if (!input) {
            // Retry after a short delay
            setTimeout(() => this.initializeCounter(counterElement), 500);
            return;
        }

        // Find the field container
        const fieldContainer =
            input.closest(".field") || counterElement.closest(".field");

        // Clean field instructions by removing the soft-limit marker
        this.cleanFieldInstructions(fieldContainer);

        // Create counter instance
        const counter = new SoftLimitCounter(input, counterElement, {
            limit: limit,
            isRichText: isRichText,
            fieldClass: fieldClass,
            fieldContainer: fieldContainer,
        });

        this.counters.set(inputId, counter);
    }

    findInputElement(inputId) {
        return (
            document.getElementById(inputId) ||
            document.querySelector('[name*="' + inputId.split("-").pop() + '"]')
        );
    }

    cleanFieldInstructions(fieldContainer) {
        if (!fieldContainer) return;

        const instructionsElements = fieldContainer.querySelectorAll(
            ".instructions p, .instructions, .field-instructions p, .field-instructions"
        );

        instructionsElements.forEach((elem) => {
            const text = elem.innerHTML || elem.textContent || "";
            if (text.match(/\[soft-limit:\s*\d+\s*\]/i)) {
                const cleaned = text
                    .replace(/\s*\[soft-limit:\s*\d+\s*\]\s*/gi, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                if (elem.innerHTML !== undefined) {
                    elem.innerHTML = cleaned;
                } else {
                    elem.textContent = cleaned;
                }
            }
        });
    }

    observeNewCounters() {
        // Watch for dynamically added content
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "childList" &&
                    mutation.addedNodes.length > 0
                ) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (
                                node.classList?.contains(
                                    "soft-limit-counter"
                                ) ||
                                node.querySelector?.(".soft-limit-counter")
                            ) {
                                shouldCheck = true;
                            }
                        }
                    });
                }
            });

            if (shouldCheck) {
                setTimeout(() => this.initializeCounters(), 100);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

class SoftLimitCounter {
    constructor(input, counterElement, options) {
        this.input = input;
        this.counterElement = counterElement;
        this.limit = options.limit;
        this.isRichText = options.isRichText;
        this.fieldClass = options.fieldClass;
        this.fieldContainer = options.fieldContainer;

        this.lastLength = 0;
        this.checkInterval = null;

        this.init();
    }

    init() {
        this.updateCounter();
        this.setupEventListeners();

        // Set up periodic check for rich text editors
        if (this.isRichText) {
            this.checkInterval = setInterval(() => {
                const currentLength = this.getTextLength();
                if (currentLength !== this.lastLength) {
                    this.updateCounter();
                    this.lastLength = currentLength;
                }
            }, 500);
        }
    }

    getTextLength() {
        if (this.isRichText) {
            let content = "";

            // For CKEditor 5 (craft\ckeditor\Field)
            if (this.fieldClass === "craft\\ckeditor\\Field") {
                const editableElement = this.fieldContainer?.querySelector(
                    ".ck-editor__editable"
                );
                if (editableElement) {
                    content = editableElement.innerHTML || "";
                }
            }

            // Try CKEditor 4 instances
            if (!content && typeof CKEDITOR !== "undefined") {
                const ckInstance =
                    CKEDITOR.instances[this.input.id] ||
                    CKEDITOR.instances[this.input.name];
                if (ckInstance) {
                    content = ckInstance.getData();
                }
            }

            // Try Redactor
            if (
                !content &&
                typeof $ !== "undefined" &&
                this.input.classList.contains("redactor")
            ) {
                const redactorInstance = $(this.input).data("redactor");
                if (redactorInstance) {
                    content = redactorInstance.code.get();
                }
            }

            // Fallback to textarea value
            if (!content) {
                content = this.input.value || "";
            }

            // Strip HTML tags for character count
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = content;
            return (tempDiv.textContent || tempDiv.innerText || "").length;
        } else {
            return (this.input.value || "").length;
        }
    }

    updateCounter() {
        const length = this.getTextLength();
        const percentage = (length / this.limit) * 100;

        this.counterElement.textContent = `${length}/${this.limit}`;

        // Update styling based on limit
        this.counterElement.classList.remove(
            "soft-limit-warning",
            "soft-limit-exceeded"
        );
        if (percentage >= 100) {
            this.counterElement.classList.add("soft-limit-exceeded");
        } else if (percentage >= 80) {
            this.counterElement.classList.add("soft-limit-warning");
        }
    }

    setupEventListeners() {
        if (this.isRichText) {
            this.setupRichTextListeners();
        } else {
            this.setupPlainTextListeners();
        }
    }

    setupPlainTextListeners() {
        const updateCounter = () => this.updateCounter();

        this.input.addEventListener("input", updateCounter);
        this.input.addEventListener("keyup", updateCounter);
        this.input.addEventListener("change", updateCounter);
        this.input.addEventListener("paste", () =>
            setTimeout(updateCounter, 10)
        );
    }

    setupRichTextListeners() {
        const updateCounter = () => this.updateCounter();

        // CKEditor 5 (craft\ckeditor\Field)
        if (this.fieldClass === "craft\\ckeditor\\Field") {
            const editableElement = this.fieldContainer?.querySelector(
                ".ck-editor__editable"
            );
            if (editableElement) {
                editableElement.addEventListener("input", updateCounter);
                editableElement.addEventListener("keyup", updateCounter);
                editableElement.addEventListener("paste", () =>
                    setTimeout(updateCounter, 50)
                );
                editableElement.addEventListener("blur", updateCounter);

                // Set up mutation observer for content changes
                const contentObserver = new MutationObserver((mutations) => {
                    let shouldUpdate = false;
                    mutations.forEach((mutation) => {
                        if (
                            mutation.type === "childList" ||
                            mutation.type === "characterData"
                        ) {
                            shouldUpdate = true;
                        }
                    });
                    if (shouldUpdate) {
                        setTimeout(updateCounter, 10);
                    }
                });

                contentObserver.observe(editableElement, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                });

                // Try to find the CKEditor instance for more advanced events
                this.setupCKEditor5Instance(editableElement, updateCounter);
            }
        }
        // CKEditor 4 events
        else if (typeof CKEDITOR !== "undefined") {
            const ckInstance =
                CKEDITOR.instances[this.input.id] ||
                CKEDITOR.instances[this.input.name];
            if (ckInstance) {
                ckInstance.on("change", updateCounter);
                ckInstance.on("key", () => setTimeout(updateCounter, 10));
                ckInstance.on("paste", () => setTimeout(updateCounter, 50));
            }
        }
        // Redactor events
        else if (
            typeof $ !== "undefined" &&
            this.input.classList.contains("redactor")
        ) {
            const redactorInstance = $(this.input).data("redactor");
            if (redactorInstance) {
                redactorInstance.core.editor().on("keyup input", updateCounter);
                redactorInstance.core
                    .editor()
                    .on("paste", () => setTimeout(updateCounter, 50));
            }
        }

        // Fallback events for rich text
        this.input.addEventListener("input", updateCounter);
        this.input.addEventListener("keyup", updateCounter);
        this.input.addEventListener("change", updateCounter);
        this.input.addEventListener("paste", () =>
            setTimeout(updateCounter, 50)
        );
    }

    setupCKEditor5Instance(editableElement, updateCounter) {
        const checkForInstance = () => {
            if (editableElement.ckeditorInstance) {
                const editor = editableElement.ckeditorInstance;
                try {
                    editor.model.document.on("change:data", updateCounter);
                    editor.editing.view.document.on("keyup", () =>
                        setTimeout(updateCounter, 10)
                    );
                } catch (e) {
                    // Silently handle any CKEditor API errors
                    console.warn(
                        "Soft Limit: Could not bind to CKEditor instance",
                        e
                    );
                }
            } else {
                setTimeout(checkForInstance, 100);
            }
        };
        checkForInstance();
    }

    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
    }
}

// Initialize the manager when the script loads
window.SoftLimitManager = SoftLimitManager;
window.softLimitManager = new SoftLimitManager();
