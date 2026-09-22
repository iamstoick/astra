FROM nginx:alpine

# Static dashboard only: no build step, no runtime deps.
RUN rm /etc/nginx/conf.d/default.conf
COPY index.html styles.css app.js /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Container-side listen port. Overridable: docker run -e ASTRA_PORT=8080.
ENV ASTRA_PORT=5555
EXPOSE 5555
