#include <boost/version.hpp>
#include <boost/filesystem.hpp>
#include <boost/thread.hpp>
#include <iostream>

namespace fs = boost::filesystem;

int main()
{
    std::cout << "Boost 版本: " << BOOST_LIB_VERSION << std::endl;

    // filesystem：打印当前工作目录
    std::cout << "当前目录: " << fs::current_path().string() << std::endl;

    // thread：起一个线程验证
    boost::thread t([] {
        std::cout << "Boost 线程运行中, id = "
                  << boost::this_thread::get_id() << std::endl;
    });
    t.join();

    return 0;
}
