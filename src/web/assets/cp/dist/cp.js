/**
 * Soft Limit Plugin JavaScript
 * Handles character counting for text fields with soft limits
 */

// Configuration constants
const CONFIG = {
    RETRY_DELAY: 500,
    MUTATION_DELAY: 100,
    DEBOUNCE_FAST: 50,
    DEBOUNCE_MUTATION: 100,
    PASTE_DELAY: 50,
    CKINSTANCE_CHECK_DELAY: 100,
    MAX_LIMIT: 100000,
};

class SoftLimitManager {
    constructor() {
        this.counters = new Map();
        this.retryTimers = new Set();
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
        const rawLimit = counterElement.dataset.limit;
        const isRichText = counterElement.dataset.richText === "1";
        const fieldClass = counterElement.dataset.fieldClass;

        // Validate and sanitize the limit
        const limit = this.validateLimit(rawLimit);
        if (limit === null) {
            console.warn(
                `Soft Limit: Invalid limit "${rawLimit}" for field ${inputId}. Skipping initialization.`
            );
            return;
        }

        // Find the input element with improved error handling
        const input = this.findInputElement(inputId);
        if (!input) {
            // Retry with timeout tracking
            const retryTimer = setTimeout(() => {
                this.retryTimers.delete(retryTimer);
                this.initializeCounter(counterElement);
            }, CONFIG.RETRY_DELAY);
            this.retryTimers.add(retryTimer);
            return;
        }

        // Find the field container
        const fieldContainer =
            input.closest(".field") || counterElement.closest(".field");

        // Create counter instance
        const counter = new SoftLimitCounter(input, counterElement, {
            limit: limit,
            isRichText: isRichText,
            fieldClass: fieldClass,
            fieldContainer: fieldContainer,
        });

        this.counters.set(inputId, counter);
    }

    validateLimit(rawLimit) {
        // Convert to number
        const limit = parseInt(rawLimit, 10);

        // Check if it's a valid number
        if (isNaN(limit)) {
            return null;
        }

        // Check minimum limit (at least 1 character)
        if (limit < 1) {
            return null;
        }

        // Check maximum limit (prevent performance issues)
        if (limit > CONFIG.MAX_LIMIT) {
            console.warn(
                `Soft Limit: Limit ${limit} is too large. Using maximum of ${CONFIG.MAX_LIMIT}.`
            );
            return CONFIG.MAX_LIMIT;
        }

        return limit;
    }

    /**
     * Basic HTML sanitization to prevent XSS when counting characters
     * @param {string} html
     * @returns {string}
     */
    sanitizeHtml(html) {
        if (!html || typeof html !== "string") {
            return "";
        }

        // Remove script tags and their content
        let sanitized = html.replace(
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            ""
        );

        // Remove dangerous event handlers
        sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "");

        // Remove javascript: URLs
        sanitized = sanitized.replace(
            /href\s*=\s*["']javascript:[^"']*["']/gi,
            ""
        );

        return sanitized;
    }

    findInputElement(inputId) {
        // Try direct ID lookup first (fastest)
        const directMatch = document.getElementById(inputId);
        if (directMatch) return directMatch;

        // More targeted fallback using field containers
        const fields = document.querySelectorAll(".field");
        for (const field of fields) {
            const input =
                field.querySelector(`[name$="${inputId}"]`) ||
                field.querySelector(`[name*="${inputId.split("-").pop()}"]`);
            if (input) return input;
        }

        return null;
    }

    // Cleanup method for destroying manager
    destroy() {
        // Cancel any pending retry timers
        this.retryTimers.forEach((timer) => clearTimeout(timer));
        this.retryTimers.clear();

        // Destroy all counter instances
        this.counters.forEach((counter) => counter.destroy());
        this.counters.clear();
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
                setTimeout(
                    () => this.initializeCounters(),
                    CONFIG.MUTATION_DELAY
                );
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

        // Track resources for cleanup
        this.observers = [];
        this.eventListeners = [];
        this.timers = [];

        this.init();
    }

    // Helper to track event listeners for cleanup
    addEventListenerTracked(element, event, handler, options) {
        element.addEventListener(event, handler, options);
        this.eventListeners.push({ element, event, handler, options });
    }

    // Helper to track observers for cleanup
    addObserverTracked(observer) {
        this.observers.push(observer);
        return observer;
    }

    // Helper to track timers for cleanup
    addTimerTracked(timer) {
        this.timers.push(timer);
        return timer;
    }

    // Debounce utility function
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    init() {
        this.updateCounter();
        this.setupEventListeners();
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
            // Use textContent to safely set content, then get text length
            tempDiv.textContent = ""; // Clear any content first
            tempDiv.innerHTML = window.softLimitManager.sanitizeHtml(content);
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
        const debouncedUpdate = this.debounce(
            updateCounter,
            CONFIG.DEBOUNCE_FAST
        );

        this.addEventListenerTracked(this.input, "input", debouncedUpdate);
        this.addEventListenerTracked(this.input, "keyup", debouncedUpdate);
        this.addEventListenerTracked(this.input, "change", updateCounter);
        this.addEventListenerTracked(this.input, "paste", () =>
            this.addTimerTracked(setTimeout(updateCounter, 10))
        );
    }

    setupRichTextListeners() {
        const updateCounter = () => this.updateCounter();
        const debouncedUpdate = this.debounce(
            updateCounter,
            CONFIG.DEBOUNCE_FAST
        );

        // CKEditor 5 (craft\ckeditor\Field)
        if (this.fieldClass === "craft\\ckeditor\\Field") {
            const editableElement = this.fieldContainer?.querySelector(
                ".ck-editor__editable"
            );
            if (editableElement) {
                this.addEventListenerTracked(
                    editableElement,
                    "input",
                    debouncedUpdate
                );
                this.addEventListenerTracked(
                    editableElement,
                    "keyup",
                    debouncedUpdate
                );
                this.addEventListenerTracked(editableElement, "paste", () =>
                    this.addTimerTracked(
                        setTimeout(updateCounter, CONFIG.PASTE_DELAY)
                    )
                );
                this.addEventListenerTracked(
                    editableElement,
                    "blur",
                    updateCounter
                );

                // Set up mutation observer for content changes
                const debouncedMutationUpdate = this.debounce(
                    updateCounter,
                    CONFIG.DEBOUNCE_MUTATION
                );
                const contentObserver = this.addObserverTracked(
                    new MutationObserver((mutations) => {
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
                            debouncedMutationUpdate();
                        }
                    })
                );

                contentObserver.observe(editableElement, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                });

                // Try to find the CKEditor instance for more advanced events
                this.setupCKEditor5Instance(editableElement, debouncedUpdate);
            }
        }
        // CKEditor 4 events
        else if (typeof CKEDITOR !== "undefined") {
            const ckInstance =
                CKEDITOR.instances[this.input.id] ||
                CKEDITOR.instances[this.input.name];
            if (ckInstance) {
                ckInstance.on("change", updateCounter);
                ckInstance.on("key", debouncedUpdate);
                ckInstance.on("paste", () =>
                    this.addTimerTracked(
                        setTimeout(updateCounter, CONFIG.PASTE_DELAY)
                    )
                );
            }
        }
        // Redactor events
        else if (
            typeof $ !== "undefined" &&
            this.input.classList.contains("redactor")
        ) {
            try {
                const redactorInstance = $(this.input).data("redactor");
                if (redactorInstance) {
                    redactorInstance.core
                        .editor()
                        .on("keyup input", debouncedUpdate);
                    redactorInstance.core
                        .editor()
                        .on("paste", () =>
                            this.addTimerTracked(
                                setTimeout(updateCounter, CONFIG.PASTE_DELAY)
                            )
                        );
                }
            } catch (e) {
                console.warn("Soft Limit: Error setting up Redactor events", e);
            }
        }
    }

    setupCKEditor5Instance(editableElement, debouncedUpdate) {
        const checkForInstance = () => {
            if (editableElement.ckeditorInstance) {
                const editor = editableElement.ckeditorInstance;
                try {
                    editor.model.document.on("change:data", debouncedUpdate);
                    editor.editing.view.document.on("keyup", debouncedUpdate);
                } catch (e) {
                    // Silently handle any CKEditor API errors
                    console.warn(
                        "Soft Limit: Could not bind to CKEditor instance",
                        e
                    );
                }
            } else {
                this.addTimerTracked(
                    setTimeout(checkForInstance, CONFIG.CKINSTANCE_CHECK_DELAY)
                );
            }
        };
        checkForInstance();
    }

    destroy() {
        // Clean up event listeners
        this.eventListeners.forEach(({ element, event, handler, options }) => {
            element.removeEventListener(event, handler, options);
        });
        this.eventListeners = [];

        // Clean up observers
        this.observers.forEach((observer) => observer.disconnect());
        this.observers = [];

        // Clean up timers
        this.timers.forEach((timer) => clearTimeout(timer));
        this.timers = [];
    }
}

// Initialize the manager when the script loads
window.SoftLimitManager = SoftLimitManager;
window.softLimitManager = new SoftLimitManager();
