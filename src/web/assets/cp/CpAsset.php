<?php

namespace tallowandsons\softlimit\web\assets\cp;

use Craft;
use craft\web\AssetBundle;

/**
 * Cp asset bundle
 */
class CpAsset extends AssetBundle
{
    public $sourcePath = __DIR__ . '/dist';
    public $depends = [];
    public $js = ['cp.js'];
    public $css = ['cp.css'];
}
