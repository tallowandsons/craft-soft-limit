<?php

namespace tallowandsons\softlimit;

use Craft;
use craft\base\Field;
use craft\base\Model;
use craft\base\Plugin;
use craft\base\SavableComponent;
use craft\events\DefineFieldHtmlEvent;
use craft\events\ModelEvent;
use craft\events\TemplateEvent;
use craft\fields\PlainText;
use craft\web\View;
use tallowandsons\softlimit\models\Settings;
use tallowandsons\softlimit\web\assets\cp\CpAsset;
use yii\base\Event;

/**
 * Soft Limit plugin
 *
 * @method static SoftLimit getInstance()
 * @method Settings getSettings()
 * @author tallowandsons
 * @copyright tallowandsons
 * @license https://craftcms.github.io/license/ Craft License
 */
class SoftLimit extends Plugin
{
    public string $schemaVersion = '1.0.0';
    public bool $hasCpSettings = true;

    private static bool $immediateScriptInjected = false;

    public static function config(): array
    {
        return [
            'components' => [
                // Define component configs here...
            ],
        ];
    }

    public function init(): void
    {
        parent::init();

        $this->attachEventHandlers();
        $this->registerAssetBundles();

        // Any code that creates an element query or loads Twig should be deferred until
        // after Craft is fully initialized, to avoid conflicts with other plugins/modules
        Craft::$app->onInit(function () {
            // ...
        });
    }

    protected function createSettingsModel(): ?Model
    {
        return Craft::createObject(Settings::class);
    }

    protected function settingsHtml(): ?string
    {
        return Craft::$app->view->renderTemplate('soft-limit/_settings.twig', [
            'plugin' => $this,
            'settings' => $this->getSettings(),
        ]);
    }

    private function attachEventHandlers(): void
    {
        // Register event handlers here ...
        // (see https://craftcms.com/docs/5.x/extend/events.html to get started)

        $this->registerFieldEvents();
        $this->registerFieldValidation();
    }

    /**
     * Registers asset bundles
     */
    private function registerAssetBundles(): void
    {
        // Load CSS before template is rendered
        Event::on(
            View::class,
            View::EVENT_BEFORE_RENDER_TEMPLATE,
            function (TemplateEvent $event) {
                if (Craft::$app->getRequest()->getIsCpRequest()) {
                    Craft::$app->view->registerAssetBundle(CpAsset::class);
                }
            }
        );
    }

    /**
     * Get the field types that support soft limit functionality
     *
     * @return array
     */
    private function getAllowedFieldTypes(): array
    {
        $fieldTypes = [
            PlainText::class,
        ];

        // Add CKEditor if it exists
        if (class_exists('craft\\ckeditor\\Field')) {
            $fieldTypes[] = 'craft\\ckeditor\\Field';
        }

        return $fieldTypes;
    }

    private function registerFieldEvents()
    {
        foreach ($this->getAllowedFieldTypes() as $fieldType) {

            // when the field input HTML is defined,
            // inject the soft limit counter based on the field's instructions
            Event::on(
                $fieldType,
                Field::EVENT_DEFINE_INPUT_HTML,
                function (DefineFieldHtmlEvent $event) {

                    /** @var Field $field */
                    $field = $event->sender;

                    // Check field instructions for soft limit marker
                    // (limit is always validated at this point)
                    $softLimit = $this->getSoftLimit($field);

                    if ($softLimit && $softLimit > 0) {
                        $view = Craft::$app->getView();
                        $inputId = $view->namespaceInputId($field->handle);
                        $fieldClass = get_class($field);
                        $isRichText = in_array($fieldClass, ['craft\\fields\\Redactor', 'craft\\fields\\CKEditor', 'craft\\ckeditor\\Field']);

                        // Add the counter HTML with all necessary data attributes
                        $counterHtml = '<div class="soft-limit-counter" ' .
                            'data-input="' . htmlspecialchars($inputId) . '" ' .
                            'data-limit="' . $softLimit . '" ' .
                            'data-rich-text="' . ($isRichText ? '1' : '0') . '" ' .
                            'data-field-class="' . htmlspecialchars($fieldClass) . '">' .
                            '0/' . $softLimit . '</div>';

                        // Only inject the immediate script once per page load
                        if (!self::$immediateScriptInjected) {
                            self::$immediateScriptInjected = true;

                            // Get the script path relative to the plugin base path
                            $scriptPath = $this->getBasePath() . '/web/assets/cp/dist/immediate-cleanup.js';

                            if (file_exists($scriptPath)) {
                                $scriptContent = file_get_contents($scriptPath);

                                // Inject inline for immediate execution
                                $immediateScript = '<script>' . $scriptContent . '</script>';
                                $event->html .= $immediateScript;
                            } else {
                                Craft::warning("Soft Limit: Could not find immediate cleanup script at {$scriptPath}", __METHOD__);
                            }
                        }
                        $event->html .= $counterHtml;
                    }
                }
            );
        }
    }

    /**
     * When field configuration is saved, validate soft limit instructions
     * This ensures that the instructions are valid and only contain one soft limit marker.
     */
    private function registerFieldValidation(): void
    {
        foreach ($this->getAllowedFieldTypes() as $fieldType) {
            Event::on(
                $fieldType,
                SavableComponent::EVENT_BEFORE_SAVE,
                function (ModelEvent $event) {

                    /** @var Field $field */
                    $field = $event->sender;

                    // Only validate if field has instructions
                    if (!$field->instructions) {
                        return;
                    }

                    $this->validateSoftLimitInstructions($field, $event);
                }
            );
        }
    }

    /**
     * Validates soft limit instructions in field instructions
     *
     * @param Field $field The field being saved
     * @param ModelEvent $event The model event
     */
    private function validateSoftLimitInstructions(Field $field, ModelEvent $event): void
    {
        $instructions = $field->instructions;

        // Find all soft-limit markers in the instructions
        $matches = [];
        $matchCount = preg_match_all('/\[soft-limit:([^\]]+)\]/', $instructions, $matches, PREG_SET_ORDER);

        if ($matchCount === 0) {
            return; // No soft-limit markers found, nothing to validate
        }

        $errors = [];

        foreach ($matches as $match) {
            $fullMatch = $match[0]; // e.g., "[soft-limit:100]"
            $limitValue = trim($match[1]); // e.g., "100"

            // Check if the limit value is a valid integer
            if (!ctype_digit($limitValue)) {
                $errors[] = "Invalid soft limit value '{$limitValue}' in '{$fullMatch}'. Must be a positive integer.";
                continue;
            }

            $numericLimit = (int)$limitValue;
            $validatedLimit = $this->validateLimit($numericLimit);

            if ($validatedLimit === null) {
                $errors[] = "Invalid soft limit value '{$limitValue}' in '{$fullMatch}'. Must be between 1 and 100,000.";
            }
        }

        // Check for multiple soft-limit markers (not allowed)
        if ($matchCount > 1) {
            $errors[] = "Multiple soft-limit markers found. Only one [soft-limit:X] marker is allowed per field.";
        }

        // If there are validation errors, prevent saving and add errors to the field
        if (!empty($errors)) {
            $event->isValid = false;

            foreach ($errors as $error) {
                $field->addError('instructions', $error);
                Craft::warning("Soft Limit validation error for field '{$field->handle}': {$error}", __METHOD__);
            }
        }
    }

    /**
     * Extract and validate soft limit from field instructions
     *
     * @param Field $field The field to check
     * @return int|null Returns the validated soft limit or null if none found or invalid
     */
    private function getSoftLimit(Field $field): ?int
    {
        $instructions = $this->getFieldInstructions($field);

        if (!$instructions) {
            return null;
        }

        if (preg_match('/\[soft-limit:(\d+)\]/', $instructions, $matches)) {
            $rawLimit = (int)$matches[1];
            $softLimit = $this->validateLimit($rawLimit);

            if ($softLimit === null) {
                Craft::warning("Soft Limit: Invalid limit '{$rawLimit}' for field '{$field->handle}'. Skipping.", __METHOD__);
                return null;
            }

            return $softLimit;
        }

        return null;
    }

    /**
     * Validate and sanitize the soft limit value
     *
     * @param int $rawLimit
     * @return int|null Returns validated limit or null if invalid
     */
    private function validateLimit(int $rawLimit): ?int
    {
        // Check minimum limit (at least 1 character)
        if ($rawLimit < 1) {
            return null;
        }

        // Check maximum limit (prevent performance issues and reasonable limits)
        if ($rawLimit > 100000) {
            return null;
        }

        return $rawLimit;
    }

    /**
     * Get the effective instructions for a field, considering layout overrides.
     */
    private function getFieldInstructions(Field $field): ?string
    {
        // in < Craft 5.5.0, $field->instructions does not take layout overrides into account,
        // so we need to check for layout element overrides manually.

        if (isset($field->layoutElement) && $field->layoutElement instanceof \craft\fieldlayoutelements\CustomField) {
            $layoutElement = $field->layoutElement;

            // If the layout element has custom instructions, use those
            if ($layoutElement->instructions !== null) {
                return $layoutElement->instructions;
            }
        }

        // Otherwise, return the field's instructions directly
        return $field->instructions ?? null;
    }
}
