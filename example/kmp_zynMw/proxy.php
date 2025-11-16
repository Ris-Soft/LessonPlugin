<?php

// 设置白名单域名
$whitelist = [
    'search.kuwo.cn',
    'newlyric.kuwo.cn'
];

// 获取 url 参数并解析
if (!isset($_GET['url'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

$targetUrl = $_GET['url'];
$parsedUrl = parse_url($targetUrl);

if (!$parsedUrl || !isset($parsedUrl['host'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid URL']);
    exit;
}

$host = $parsedUrl['host'];

// 验证域名是否在白名单中
if (!in_array($host, $whitelist)) {
    http_response_code(403);
    echo json_encode(['error' => 'Domain not allowed']);
    exit;
}

// 初始化 cURL
$ch = curl_init();

$headers = [
    'Accept: */*',
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Referer: https://www.kuwo.cn/',
    'Accept-Language: zh-CN,zh;q=0.9'
];

curl_setopt_array($ch, [
    CURLOPT_URL            => $targetUrl,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_CUSTOMREQUEST  => $_SERVER['REQUEST_METHOD'],
    CURLOPT_POSTFIELDS     => file_get_contents('php://input'),
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_ENCODING       => ''
]);

$response = curl_exec($ch);

if (curl_errno($ch)) {
    http_response_code(500);
    echo json_encode(['error' => 'cURL error: ' . curl_error($ch)]);
    curl_close($ch);
    exit;
}

$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);
echo $response;

?>