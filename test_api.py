import urllib.request, json
req = urllib.request.Request(
    'https://scroll-and-sword-api.swordandscroll.workers.dev/', 
    data=b'{"theme":"medieval","hp":10,"act":1,"step":1}', 
    headers={'Content-Type': 'application/json'}
)
try:
    res = urllib.request.urlopen(req)
    print(res.read().decode())
except Exception as e:
    print(e)
