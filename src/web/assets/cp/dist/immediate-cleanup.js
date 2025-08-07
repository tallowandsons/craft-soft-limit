(function () {
    // Global function to clean soft-limit markers from instructions
    function cleanSoftLimitInstructions() {
        var allInstructionsElements = document.querySelectorAll(
            ".field .instructions p, .field .instructions, .field .field-instructions p, .field .field-instructions"
        );

        allInstructionsElements.forEach(function (elem) {
            var text = elem.innerHTML || elem.textContent || "";
            if (text.match(/\[soft-limit:\s*\d+\s*\]/i)) {
                var cleaned = text
                    .replace(/\s*\[soft-limit:\s*\d+\s*\]/gi, " ")
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

    // Run immediately for any existing content
    cleanSoftLimitInstructions();

    // Also run on DOM ready to catch any late-loaded content
    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            cleanSoftLimitInstructions
        );
    }

    // Watch for dynamically added content
    if (window.MutationObserver) {
        var observer = new MutationObserver(function (mutations) {
            var shouldClean = false;
            mutations.forEach(function (mutation) {
                if (
                    mutation.type === "childList" &&
                    mutation.addedNodes.length > 0
                ) {
                    for (var i = 0; i < mutation.addedNodes.length; i++) {
                        var node = mutation.addedNodes[i];
                        if (
                            node.nodeType === 1 &&
                            (node.classList.contains("field") ||
                                (node.querySelector &&
                                    node.querySelector(".field")))
                        ) {
                            shouldClean = true;
                            break;
                        }
                    }
                }
            });

            if (shouldClean) {
                setTimeout(cleanSoftLimitInstructions, 10);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
})();
