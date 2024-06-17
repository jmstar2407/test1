const apiKey = '1540e401ee084db1b3b94bdc1ff4b501';
const newsBox = document.getElementById('news-box');

async function fetchNews() {
    try {
        const response = await fetch(`https://newsapi.org/v2/top-headlines?language=en&pageSize=5&apiKey=${apiKey}`);
        if (!response.ok) {
            throw new Error(`Error: ${response.status} - ${response.statusText}`);
        }
        const data = await response.json();

        if (data.status === 'ok') {
            displayNews(data.articles);
        } else {
            newsBox.innerHTML = '<p>No se pudieron cargar las noticias. Inténtalo más tarde.</p>';
        }
    } catch (error) {
        console.error('Error fetching news:', error);
        newsBox.innerHTML = `<p>${error.message}. Inténtalo más tarde.</p>`;
    }
}

function displayNews(articles) {
    newsBox.innerHTML = '';
    articles.forEach(article => {
        const newsItem = document.createElement('div');
        newsItem.classList.add('news-item');
        newsItem.innerHTML = `
            <h2>${article.title}</h2>
            <p>${article.description || 'No hay descripción disponible.'}</p>
        `;
        newsBox.appendChild(newsItem);
    });
}

fetchNews();
