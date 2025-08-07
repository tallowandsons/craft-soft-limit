<?php

namespace tallowandsons\softlimit;

use Craft;
use craft\base\Field;
use craft\base\Model;
use craft\base\Plugin;
use craft\events\DefineFieldHtmlEvent;
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

    private function registerFieldEvents()
    {
        // Add input HTML modifications to supported field types
        $fieldTypes = [
            PlainText::class,
        ];

        // Add CKEditor if it exists
        if (class_exists('craft\\ckeditor\\Field')) {
            $fieldTypes[] = 'craft\\ckeditor\\Field';
        }

        foreach ($fieldTypes as $fieldType) {
            // Hook into input HTML generation
            Event::on(
                $fieldType,
                Field::EVENT_DEFINE_INPUT_HTML,
                function (DefineFieldHtmlEvent $event) {
                    /** @var Field $field */
                    $field = $event->sender;

                    // Check field instructions for soft limit marker
                    $softLimit = null;
                    if ($field->instructions) {
                        if (preg_match('/\[soft-limit:(\d+)\]/', $field->instructions, $matches)) {
                            $rawLimit = (int)$matches[1];
                            $softLimit = $this->validateLimit($rawLimit);

                            if ($softLimit === null) {
                                Craft::warning("Soft Limit: Invalid limit '{$rawLimit}' for field '{$field->handle}'. Skipping.", __METHOD__);
                                return;
                            }
                        }
                    }

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
            Craft::warning("Soft Limit: Limit {$rawLimit} is too large. Using maximum of 100,000.", __METHOD__);
            return 100000;
        }

        return $rawLimit;
    }
}
