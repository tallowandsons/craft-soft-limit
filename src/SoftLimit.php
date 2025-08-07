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
                            $softLimit = (int)$matches[1];

                            // Clean the instructions on the server side
                            $field->instructions = preg_replace('/\s*\[soft-limit:\d+\]\s*/', ' ', $field->instructions);
                            $field->instructions = trim(preg_replace('/\s+/', ' ', $field->instructions));
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

                        $event->html .= $counterHtml;
                    }
                }
            );
        }
    }
}
