proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
# nginx has already resolved the real client IP (real_ip module); hand Express a single clean value.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
proxy_connect_timeout 5s;
proxy_read_timeout 30s;
