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
    /**
     * Creates a new SoftLimitManager instance and initializes counter tracking.
     */
    constructor() {
        this.counters = new Map();
        this.retryTimers = new Set();
        this.init();
    }

    /**
     * Initializes the manager on DOM ready and sets up observers for dynamic content.
     */
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

    /**
     * Finds all soft limit counter elements in the DOM and initializes them.
     */
    initializeCounters() {
        const counterElements = document.querySelectorAll(
            ".soft-limit-counter"
        );
        counterElements.forEach((counterElement) => {
            if (!counterElement.dataset.initialized) {
                this.initializeCounter(counterElement);
            }
        });
    }

    /**
     * Initializes a single counter element by creating its corresponding SoftLimitCounter instance.
     */
    initializeCounter(counterElement) {
        const inputId = counterElement.dataset.input;
        const rawLimit = counterElement.dataset.limit;
        const fieldClass = counterElement.dataset.fieldClass;

        // Determine if this is a rich text field from the field class
        const isRichText = this.isRichTextField(fieldClass);

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
            // Only retry if we haven't already marked this as initialized
            if (!counterElement.dataset.initialized) {
                // Retry with timeout tracking
                const retryTimer = setTimeout(() => {
                    this.retryTimers.delete(retryTimer);
                    this.initializeCounter(counterElement);
                }, CONFIG.RETRY_DELAY);
                this.retryTimers.add(retryTimer);
            }
            return;
        }

        // Check if this counter is already initialized
        if (this.counters.has(inputId)) {
            // Destroy existing counter first
            this.counters.get(inputId).destroy();
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
        counterElement.dataset.initialized = "true";
    }

    /**
     * Determine if a field class represents a rich text field.
     * @param {string} fieldClass - The field class name
     * @returns {boolean} - True if it's a rich text field
     */
    isRichTextField(fieldClass) {
        const richTextClasses = [
            "craft\\ckeditor\\Field",
            "craft\\redactor\\Field",
        ];
        return richTextClasses.includes(fieldClass);
    }

    /**
     * Validates and sanitizes the character limit value, ensuring it's within acceptable bounds.
     */
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
     * Basic HTML sanitization to prevent XSS when counting characters.
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

    /**
     * Finds an input element by ID using multiple fallback strategies for dynamic field names.
     */
    findInputElement(inputId) {
        // Try direct ID lookup first (fastest)
        const directMatch = document.getElementById(inputId);
        if (directMatch) return directMatch;

        // More targeted fallback using field containers
        const fields = document.querySelectorAll(".field");
        for (const field of fields) {
            // Look for exact name match first
            let input = field.querySelector(`[name="${inputId}"]`);
            if (input) return input;

            // Look for name ending with the inputId
            input = field.querySelector(`[name$="${inputId}"]`);
            if (input) return input;

            // Look for partial match on the last part of the ID
            const idPart = inputId.split("-").pop();
            input = field.querySelector(`[name*="${idPart}"]`);
            if (input) return input;

            // Look for id matches
            input =
                field.querySelector(`[id="${inputId}"]`) ||
                field.querySelector(`[id$="${inputId}"]`) ||
                field.querySelector(`[id*="${idPart}"]`);
            if (input) return input;
        }

        return null;
    }

    /**
     * Manually refreshes all counter displays, useful for debugging or after content changes.
     */
    // Method to refresh all counters (useful for debugging or manual refresh)
    refreshAllCounters() {
        this.counters.forEach((counter) => counter.updateCounter());
    }

    /**
     * Cleans up all counters and timers when the manager is destroyed.
     */
    // Cleanup method for destroying manager
    destroy() {
        // Cancel any pending retry timers
        this.retryTimers.forEach((timer) => clearTimeout(timer));
        this.retryTimers.clear();

        // Destroy all counter instances
        this.counters.forEach((counter) => counter.destroy());
        this.counters.clear();
    }

    /**
     * Sets up a MutationObserver to detect dynamically added fields and counters.
     */
    observeNewCounters() {
        // Watch for dynamically added content
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            let hasNewFields = false;

            mutations.forEach((mutation) => {
                if (
                    mutation.type === "childList" &&
                    mutation.addedNodes.length > 0
                ) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check for new counter elements
                            if (
                                node.classList?.contains(
                                    "soft-limit-counter"
                                ) ||
                                node.querySelector?.(".soft-limit-counter")
                            ) {
                                shouldCheck = true;
                            }

                            // Check for new input fields that might need counters
                            if (
                                node.classList?.contains("field") ||
                                node.querySelector?.(".field") ||
                                node.querySelector?.("input, textarea") ||
                                node.classList?.contains("ck-editor") ||
                                node.querySelector?.(".ck-editor") ||
                                node.classList?.contains("redactor") ||
                                node.querySelector?.(".redactor")
                            ) {
                                hasNewFields = true;
                            }
                        }
                    });
                }
            });

            if (shouldCheck || hasNewFields) {
                // Use a longer delay for new fields to ensure they're fully initialized
                const delay = hasNewFields
                    ? CONFIG.RETRY_DELAY
                    : CONFIG.MUTATION_DELAY;
                setTimeout(() => {
                    this.initializeCounters();
                    // Also trigger an update on existing counters in case their content changed
                    this.counters.forEach((counter) => counter.updateCounter());
                }, delay);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

class SoftLimitCounter {
    /**
     * Creates a counter instance and selects the appropriate handler based on field type.
     */
    constructor(input, counterElement, options) {
        this.input = input;
        this.counterElement = counterElement;
        this.limit = options.limit;
        this.isRichText = options.isRichText;
        this.fieldClass = options.fieldClass;
        this.fieldContainer = options.fieldContainer;

        // Create the appropriate handler
        this.handler = this.createHandler();

        this.init();
    }

    /**
     * Factory method that creates the appropriate handler based on field class and editor type.
     */
    createHandler() {
        if (this.isPlainTextField()) {
            return new PlainTextHandler(this.input, this.counterElement, {
                limit: this.limit,
                fieldContainer: this.fieldContainer,
            });
        }

        if (this.isCKEditor5Field()) {
            return new CKEditor5Handler(this.input, this.counterElement, {
                limit: this.limit,
                fieldContainer: this.fieldContainer,
            });
        }

        if (this.isCKEditor4Field()) {
            return new CKEditor4Handler(this.input, this.counterElement, {
                limit: this.limit,
                fieldContainer: this.fieldContainer,
            });
        }

        if (this.isRedactorField()) {
            return new RedactorHandler(this.input, this.counterElement, {
                limit: this.limit,
                fieldClass: this.fieldClass,
                fieldContainer: this.fieldContainer,
            });
        }

        return new PlainTextHandler(this.input, this.counterElement, {
            limit: this.limit,
            fieldContainer: this.fieldContainer,
        });
    }

    /**
     * Checks if this is a plain text field (non-rich text).
     */
    isPlainTextField() {
        return !this.isRichText;
    }

    /**
     * Checks if this is a CKEditor 5 field.
     */
    isCKEditor5Field() {
        return this.fieldClass === "craft\\ckeditor\\Field";
    }

    /**
     * Checks if this is a CKEditor 4 field by detecting active instances.
     */
    isCKEditor4Field() {
        if (typeof CKEDITOR === "undefined") {
            return false;
        }

        const ckInstance =
            CKEDITOR.instances[this.input.id] ||
            CKEDITOR.instances[this.input.name];
        return !!ckInstance;
    }

    /**
     * Checks if this is a Redactor field.
     */
    isRedactorField() {
        return (
            this.fieldClass === "craft\\fields\\Redactor" ||
            this.fieldClass === "craft\\redactor\\Field"
        );
    }

    /**
     * Initializes the counter by delegating to the appropriate handler.
     */
    init() {
        this.handler.init();
    }

    /**
     * Updates the counter display by delegating to the handler.
     */
    updateCounter() {
        this.handler.updateCounter();
    }

    /**
     * Cleans up resources by destroying the handler.
     */
    destroy() {
        this.handler.destroy();
    }
}

// Base handler class with common functionality
class BaseHandler {
    /**
     * Base constructor that sets up common properties and resource tracking for cleanup.
     */
    constructor(input, counterElement, options) {
        this.input = input;
        this.counterElement = counterElement;
        this.limit = options.limit;
        this.fieldContainer = options.fieldContainer;

        // Track resources for cleanup
        this.observers = [];
        this.eventListeners = [];
        this.timers = [];
    }

    /**
     * Adds an event listener and tracks it for cleanup.
     */
    // Helper to track event listeners for cleanup
    addEventListenerTracked(element, event, handler, options) {
        element.addEventListener(event, handler, options);
        this.eventListeners.push({ element, event, handler, options });
    }

    /**
     * Adds a MutationObserver and tracks it for cleanup.
     */
    // Helper to track observers for cleanup
    addObserverTracked(observer) {
        this.observers.push(observer);
        return observer;
    }

    /**
     * Adds a timer and tracks it for cleanup.
     */
    // Helper to track timers for cleanup
    addTimerTracked(timer) {
        this.timers.push(timer);
        return timer;
    }

    /**
     * Creates a debounced version of a function to limit how often it can be called.
     */
    // Debounce utility function
    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Sanitizes HTML content by removing dangerous scripts and event handlers.
     */
    // Sanitize HTML content for character counting
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

    /**
     * Strips HTML tags from content and returns the text length for character counting.
     */
    // Strip HTML tags and get text length
    getTextFromHtml(html) {
        const tempDiv = document.createElement("div");
        tempDiv.textContent = ""; // Clear any content first
        tempDiv.innerHTML = this.sanitizeHtml(html);
        return (tempDiv.textContent || tempDiv.innerText || "").length;
    }

    /**
     * Updates the counter display with current character count and applies appropriate styling.
     */
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

    /**
     * Initializes the handler by updating the counter and setting up event listeners.
     */
    init() {
        this.updateCounter();
        this.setupEventListeners();
    }

    // Abstract methods to be implemented by subclasses
    getTextLength() {
        throw new Error("getTextLength must be implemented by subclass");
    }

    setupEventListeners() {
        throw new Error("setupEventListeners must be implemented by subclass");
    }

    /**
     * Cleans up all tracked resources including event listeners, observers, and timers.
     */
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

// Plain text handler
class PlainTextHandler extends BaseHandler {
    /**
     * Returns the character count from the textarea value.
     */
    getTextLength() {
        return (this.input.value || "").length;
    }

    /**
     * Sets up event listeners for plain text input fields.
     */
    setupEventListeners() {
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
}

// CKEditor 5 handler
class CKEditor5Handler extends BaseHandler {
    /**
     * Extracts text content from CKEditor 5's editable element or falls back to textarea value.
     */
    getTextLength() {
        const editableElement = this.fieldContainer?.querySelector(
            ".ck-editor__editable"
        );
        if (editableElement) {
            const content = editableElement.innerHTML || "";
            return this.getTextFromHtml(content);
        }
        return (this.input.value || "").length;
    }

    /**
     * Sets up event listeners and mutation observer for CKEditor 5 instances.
     */
    setupEventListeners() {
        const updateCounter = () => this.updateCounter();
        const debouncedUpdate = this.debounce(
            updateCounter,
            CONFIG.DEBOUNCE_FAST
        );

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

    /**
     * Attempts to bind to the CKEditor 5 instance for enhanced event handling.
     */
    setupCKEditor5Instance(editableElement, debouncedUpdate) {
        const checkForInstance = () => {
            if (editableElement.ckeditorInstance) {
                const editor = editableElement.ckeditorInstance;
                try {
                    editor.model.document.on("change:data", debouncedUpdate);
                    editor.editing.view.document.on("keyup", debouncedUpdate);
                } catch (e) {
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
}

// CKEditor 4 handler
class CKEditor4Handler extends BaseHandler {
    /**
     * Gets text content from CKEditor 4 instance or falls back to textarea value.
     */
    getTextLength() {
        if (typeof CKEDITOR !== "undefined") {
            const ckInstance =
                CKEDITOR.instances[this.input.id] ||
                CKEDITOR.instances[this.input.name];
            if (ckInstance) {
                const content = ckInstance.getData();
                return this.getTextFromHtml(content);
            }
        }
        return (this.input.value || "").length;
    }

    /**
     * Sets up event listeners for CKEditor 4 instances using the CKEditor API.
     */
    setupEventListeners() {
        const updateCounter = () => this.updateCounter();
        const debouncedUpdate = this.debounce(
            updateCounter,
            CONFIG.DEBOUNCE_FAST
        );

        if (typeof CKEDITOR !== "undefined") {
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
    }
}

// Redactor handler
class RedactorHandler extends BaseHandler {
    /**
     * Creates a Redactor handler with field class information for specialized handling.
     */
    constructor(input, counterElement, options) {
        super(input, counterElement, options);
        this.fieldClass = options.fieldClass;
    }

    /**
     * Gets text content from Redactor instance or contenteditable elements, with textarea fallback.
     */
    getTextLength() {
        // First try to get content from Redactor instance (if available)
        if (
            typeof $ !== "undefined" &&
            this.input.classList.contains("redactor")
        ) {
            const redactorInstance = $(this.input).data("redactor");
            if (redactorInstance && redactorInstance.code) {
                const content = redactorInstance.code.get();
                return this.getTextFromHtml(content);
            }
        }

        // Try to get content from contenteditable elements
        const fieldContainer = this.input.closest(".field");
        if (fieldContainer) {
            const contentEditableElements = fieldContainer.querySelectorAll(
                '[contenteditable="true"]'
            );
            if (contentEditableElements.length > 0) {
                // Get content from the first contenteditable element (usually the main editor)
                const editorContent =
                    contentEditableElements[0].innerHTML || "";
                return this.getTextFromHtml(editorContent);
            }
        }

        // Fallback to textarea value
        return (this.input.value || "").length;
    }

    /**
     * Sets up event listeners for Redactor by delegating to the retry mechanism.
     */
    setupEventListeners() {
        const updateCounter = () => this.updateCounter();
        const debouncedUpdate = this.debounce(
            updateCounter,
            CONFIG.DEBOUNCE_FAST
        );

        this.setupRedactorListeners(debouncedUpdate, updateCounter);
    }

    /**
     * Implements retry logic to wait for Redactor's contenteditable elements to be ready.
     */
    setupRedactorListeners(debouncedUpdate, updateCounter) {
        let retryCount = 0;
        const maxRetries = 10; // Try for up to 1 second (10 * 100ms)

        const checkForRedactorInstance = () => {
            try {
                // Try to find contenteditable elements in the field container
                const fieldContainer = this.input.closest(".field");
                if (fieldContainer) {
                    const contentEditableElements =
                        fieldContainer.querySelectorAll(
                            '[contenteditable="true"]'
                        );
                    if (contentEditableElements.length > 0) {
                        return this.setupDirectContentEditableEvents(
                            contentEditableElements,
                            debouncedUpdate,
                            updateCounter
                        );
                    }
                }

                // If we haven't found contenteditable elements yet and haven't exceeded max retries, retry
                if (retryCount < maxRetries) {
                    retryCount++;
                    this.addTimerTracked(
                        setTimeout(
                            checkForRedactorInstance,
                            CONFIG.CKINSTANCE_CHECK_DELAY
                        )
                    );
                } else {
                    // Fallback to plain text events if no contenteditable elements found after retries
                    this.fallbackToPlainText(debouncedUpdate, updateCounter);
                }
            } catch (e) {
                console.warn("Soft Limit: Error setting up Redactor events", e);
                this.fallbackToPlainText(debouncedUpdate, updateCounter);
            }
        };

        // Check immediately and retry if needed
        checkForRedactorInstance();
    }

    /**
     * Binds events directly to contenteditable elements with mutation observer for content changes.
     */
    setupDirectContentEditableEvents(
        contentEditableElements,
        debouncedUpdate,
        updateCounter
    ) {
        // Set up events on all contenteditable elements
        contentEditableElements.forEach((element) => {
            // Bind direct DOM events
            this.addEventListenerTracked(element, "input", debouncedUpdate);
            this.addEventListenerTracked(element, "keyup", debouncedUpdate);
            this.addEventListenerTracked(element, "paste", () =>
                this.addTimerTracked(
                    setTimeout(updateCounter, CONFIG.PASTE_DELAY)
                )
            );
            this.addEventListenerTracked(element, "blur", updateCounter);

            // Set up mutation observer to catch any content changes
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
                        debouncedUpdate();
                    }
                })
            );

            contentObserver.observe(element, {
                childList: true,
                subtree: true,
                characterData: true,
            });
        });

        return true;
    }

    /**
     * Fallback method that sets up basic event listeners on the textarea element.
     */
    fallbackToPlainText(debouncedUpdate, updateCounter) {
        this.addEventListenerTracked(this.input, "input", debouncedUpdate);
        this.addEventListenerTracked(this.input, "keyup", debouncedUpdate);
        this.addEventListenerTracked(this.input, "change", updateCounter);
        this.addEventListenerTracked(this.input, "paste", () =>
            this.addTimerTracked(setTimeout(updateCounter, 10))
        );
    }
}

// Initialize the manager when the script loads
window.SoftLimitManager = SoftLimitManager;
window.softLimitManager = new SoftLimitManager();
